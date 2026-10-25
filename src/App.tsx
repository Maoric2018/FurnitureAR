import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Armchair, Box, Camera, Check, Copy, Grid2X2, HelpCircle, Home, Layers, Link2, Plus, Search, Trash2, X } from 'lucide-react';
import type { ProductItem, RoomLayout } from './lib/workspace';
import { createScannedLayout, duplicateLayout, placeItem, readWorkspace, relativeDate, saveWorkspace, selectItemVariant } from './lib/workspace';
import { readUnit, writeUnit } from './lib/storage';
import type { Unit } from './lib/products';
import Modal from './components/Modal';
import LinkInput from './components/LinkInput';
import FloorPlan from './components/FloorPlan';
import NewLayout from './components/NewLayout';
import RoomScanImport from './components/RoomScanImport';
import { parseRoomScan, readRoomScanFragment } from './lib/room-scan';
import type { ImportedRoom } from './lib/room-scan';
import { hasNativeRoomAR, nativeRequest } from './lib/native-room';
import type { AmazonProductResult } from './lib/amazon';
import { resolveModelItem } from './lib/model-resolution';
import { useModelJobs } from './lib/use-model-jobs';
import ModelJobsPanel from './components/ModelJobsPanel';
const PreviewModal=lazy(()=>import('./components/PreviewModal'));
const RoomEditor=lazy(()=>import('./components/RoomEditor'));

const PhotoStudio=lazy(()=>import('./components/PhotoStudio'));
import './components/photo-studio.css';

type Page='home'|'layouts'|'photo';
export default function App(){
  const [workspace,setWorkspace]=useState(readWorkspace),[persisted,setPersisted]=useState(true);
  const [scanOpen,setScanOpen]=useState(false),[scanError,setScanError]=useState<string>();
  const [page,setPage]=useState<Page>(()=>new URLSearchParams(window.location.search).has('photo')?'photo':'home'),[roomId,setRoomId]=useState<string|null>(null),[query,setQuery]=useState('');
  const [preview,setPreview]=useState<ProductItem|null>(null),[createOpen,setCreateOpen]=useState(false),[pendingItem,setPendingItem]=useState<ProductItem|null>(null);
  const [unit,setUnit]=useState<Unit>(readUnit),[help,setHelp]=useState(false),[phone,setPhone]=useState(false),[copied,setCopied]=useState(false);
  const [autoOpenCamera,setAutoOpenCamera]=useState(false);
  const [jobsOpen,setJobsOpen]=useState(false);
  const openPhoto=()=>{setAutoOpenCamera(true);setPage('photo');setRoomId(null);window.scrollTo({top:0});};
  const [toast,setToast]=useState<{message:string;undo?:()=>void}|null>(null);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{setPersisted(saveWorkspace(workspace));},[workspace]);
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
  const notify=useCallback((message:string,undo?:()=>void)=>{setToast({message,undo});if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setToast(null),6000);},[]);
  const navigate=(next:Page)=>{setAutoOpenCamera(false);setPage(next);setRoomId(null);setQuery('');window.scrollTo({top:0});};
  const openRoom=(id:string)=>{setRoomId(id);setPage('layouts');window.scrollTo({top:0});};
  const updateRoom=(room:RoomLayout)=>setWorkspace(current=>({...current,layouts:current.layouts.map(item=>item.id===room.id?room:item)}));
  const removeRoom=(room:RoomLayout)=>{setWorkspace(current=>({...current,layouts:current.layouts.filter(item=>item.id!==room.id)}));notify('Layout deleted.',()=>setWorkspace(current=>({...current,layouts:[room,...current.layouts]})));};
  const room=workspace.layouts.find(item=>item.id===roomId);
  const layouts=[...workspace.layouts].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).filter(item=>`${item.name} ${item.roomType}`.toLowerCase().includes(query.toLowerCase()));
  const startRoom=(item?:ProductItem)=>{setPendingItem(item??null);setCreateOpen(true);};
  const resolveModel=useCallback((id:string,result:AmazonProductResult)=>{
    setPreview(current=>current?resolveModelItem(current,id,result,true):current);
  },[]);
  const {jobs,manager}=useModelJobs(resolveModel,item=>notify(`3D model ready: ${item.name}`));
  const activeJobs=jobs.filter(job=>['starting','pending','checking'].includes(job.state)).length;
  const openPreview=(item:ProductItem)=>{
    manager.track(item,true);
    const tracked=manager.getSnapshot().find(job=>job.asin===item.listing?.asin);
    if(!item.product&&tracked?.item.listing){
      item=resolveModelItem(item,item.id,{listing:tracked.item.listing,product:tracked.item.product});
    }
    manager.track(item);setPreview(item);
  };
  const generateModel=()=>{
    if(!preview?.listing)return;
    try{
      manager.generate(preview);
      notify('Generating model. You can keep browsing.');
    }catch(error){notify((error as Error).message);}
  };
  const checkModel=()=>{
    if(!preview?.listing)return;
    manager.track(preview);manager.check(preview.listing.asin);
  };
  const addToRoom=(id:string)=>{if(!preview)return;const layout=workspace.layouts.find(item=>item.id===id);if(!layout)return;try{updateRoom(placeItem(layout,preview));setPreview(null);openRoom(id);notify('Product added to layout.');}catch(error){notify((error as Error).message);}};
  const createRoom=(layout:RoomLayout)=>{
    try{
      const created=pendingItem?placeItem(layout,pendingItem):layout;
      setWorkspace(current=>({...current,layouts:[created,...current.layouts]}));
      setCreateOpen(false);setScanOpen(false);setScanError(undefined);setPendingItem(null);openRoom(created.id);
    }catch(error){notify((error as Error).message);}
  };
  // Files, Safari links and the native scanner all enter the regular layout editor.
  const finishScan=useCallback((scan:ImportedRoom,item?:ProductItem)=>{
    let created=createScannedLayout(scan);
    let message='Room scan saved as a new layout. Your main walls are aligned with the grid.';
    if(item){try{created=placeItem(created,item);}catch(error){message=`Room scan saved. ${(error as Error).message}`;}}
    setWorkspace(current=>({...current,layouts:[created,...current.layouts]}));
    setCreateOpen(false);setScanOpen(false);setScanError(undefined);setPendingItem(null);setPreview(null);
    setRoomId(created.id);setPage('layouts');setQuery('');window.scrollTo({top:0});notify(message);
  },[notify]);
  const receivedNativeScan=useRef<string | undefined>(undefined);
  const pendingScanItem=useRef<ProductItem|null>(pendingItem);
  pendingScanItem.current=pendingItem;
  useEffect(()=>{
    const failed=(error:unknown)=>{setScanError((error as Error).message);setCreateOpen(false);setPreview(null);setScanOpen(true);};
    const receiveLink=()=>{
      const hash=window.location.hash;if(!hash.startsWith('#room-scan='))return;
      // Consume before importing so StrictMode or a reload cannot duplicate this handoff.
      window.history.replaceState(null,'',window.location.pathname+window.location.search);
      try{const scan=readRoomScanFragment(hash);if(scan)finishScan(scan,pendingScanItem.current??undefined);}catch(error){failed(error);}
    };
    const receiveNative=(event:Event)=>{
      try{
        const scan=parseRoomScan((event as CustomEvent).detail);
        const key=JSON.stringify(scan);
        if(receivedNativeScan.current===key)return;
        receivedNativeScan.current=key;finishScan(scan,pendingScanItem.current??undefined);
      }catch(error){failed(error);}
    };
    receiveLink();window.addEventListener('hashchange',receiveLink);
    window.addEventListener('furniture-ar:scan',receiveNative);
    if(hasNativeRoomAR())void nativeRequest('ready').catch(()=>{});
    return()=>{window.removeEventListener('hashchange',receiveLink);window.removeEventListener('furniture-ar:scan',receiveNative);};
  },[finishScan]);
  const layoutCards=(items:RoomLayout[])=><div className="layout-grid">{items.map(item=><article className="layout-card" key={item.id}><button className="layout-card-plan" onClick={()=>openRoom(item.id)} aria-label={`Open ${item.name}`}><FloorPlan layout={item} compact/><span className="tag room-type-tag">{item.roomType}</span></button><div className="layout-card-info"><button onClick={()=>openRoom(item.id)}><h3>{item.name}</h3><p>{item.items.length+(item.survey?.obstacles.length??0)} {item.items.length+(item.survey?.obstacles.length??0)===1?'piece':'pieces'} · Edited {relativeDate(item.updatedAt).toLowerCase()}</p></button><div className="card-actions"><button className="icon-button" aria-label={`Duplicate ${item.name}`} title="Duplicate" onClick={()=>{const copy=duplicateLayout(item);setWorkspace(current=>({...current,layouts:[copy,...current.layouts]}));notify('Layout duplicated.');}}><Copy size={15}/></button><button className="icon-button" aria-label={`Delete ${item.name}`} title="Delete" onClick={()=>removeRoom(item)}><Trash2 size={15}/></button></div></div></article>)}</div>;
  const brand=<a className="brand" href="#" onClick={event=>{event.preventDefault();navigate('home');}} aria-label="Roomify home"><img src="/icon.svg" alt="" width={32} height={32}/><span>Roomify</span></a>;
  return <div className="app-shell"><a href="#main-content" className="skip-link">Skip to content</a>
    <aside className="sidebar">{brand}<nav aria-label="Main navigation">{([{id:'home',label:'Overview',icon:Home},{id:'photo',label:'Photo to 3D',icon:Camera},{id:'layouts',label:'My layouts',icon:Layers}] as const).map(({id,label,icon:Icon})=><button key={id} className={`side-link ${page===id?'active':''}`} aria-current={page===id?'page':undefined} title={label} onClick={()=>navigate(id)}><Icon size={16}/><span>{label}</span>{id==='layouts'&&workspace.layouts.length>0&&<small>{workspace.layouts.length}</small>}</button>)}</nav>
      <div className="sidebar-footer"><button className="side-link jobs-link" title="3D models" aria-label={`Your 3D models${activeJobs?`, ${activeJobs} in progress`:''}`} onClick={()=>setJobsOpen(true)}><Box size={16}/><span>3D models</span>{activeJobs>0&&<small>{activeJobs}</small>}</button><button className="side-link" title="Help" onClick={()=>setHelp(true)}><HelpCircle size={16}/><span>Help</span></button><p className="storage-status"><span className={persisted?'status-dot':'status-dot offline'}/>{persisted?'Saved in this browser':'Browser storage unavailable'}</p></div>
    </aside>
    <div className="app-main"><header className="mobile-header">{brand}<div className="mobile-header-actions"><button className="icon-button jobs-button" aria-label={`Your 3D models${activeJobs?`, ${activeJobs} in progress`:''}`} onClick={()=>setJobsOpen(true)}><Box size={18}/>{activeJobs>0&&<small>{activeJobs}</small>}</button><button className="icon-button" aria-label="Help" onClick={()=>setHelp(true)}><HelpCircle size={18}/></button></div></header><main id="main-content" className={room?'main-content editor-content':'main-content'}>
      {room?<Suspense fallback={<div className="workspace-loading"><span className="loading-ring"/>Opening your layout…</div>}><RoomEditor onScan={()=>{setPendingItem(null);setScanError(undefined);setScanOpen(true);}} onCreateDesign={createRoom} key={room.id} layout={room} onChange={updateRoom} onBack={()=>navigate('layouts')} onUnavailable={()=>setPhone(true)} onNotify={notify} persisted={persisted} onPreview={openPreview}/></Suspense>:<>
        {page==='photo'&&<Suspense fallback={<div className="workspace-loading"><span className="loading-ring"/>Opening photo studio…</div>}><PhotoStudio autoOpenCamera={autoOpenCamera}/></Suspense>}
        {page==='home'&&<><div className="page-heading"><div><h1>Overview</h1></div></div>
          <div className="start-grid"><section className="start-card"><div className="start-card-body"><h2>Find furniture</h2><LinkInput onProduct={openPreview}/></div></section><section className="start-card room-start"><div className="start-card-body"><h2>Plan a room</h2><p>Arrange furniture on a floor plan, then preview it in AR.</p><div className="start-card-actions"><button className="button primary" onClick={()=>startRoom()}><Plus size={16}/>New layout</button></div></div></section></div>
          <section className="photo-entry"><Camera size={20}/><div><h2>Photo to 3D</h2><p>Create a model from your own furniture.</p></div><button className="button secondary" onClick={openPhoto}><Camera size={16}/>Open camera</button></section>
          {workspace.layouts.length>0&&<section className="saved-layouts-section"><div className="section-heading"><h2>Recent layouts</h2>{workspace.layouts.length>0&&<button className="text-button" onClick={()=>navigate('layouts')}>View all</button>}</div>{layoutCards(layouts.slice(0,3))}</section>}
        </>}
        {page==='layouts'&&<><div className="page-heading"><div><h1>My layouts</h1><p>Saved automatically in this browser.</p></div><div className="page-actions"><button className="button primary" onClick={()=>startRoom()}><Plus size={16}/>New layout</button></div></div>{workspace.layouts.length?<><div className="list-toolbar"><label className="search-field"><Search size={16}/><input placeholder="Search layouts" aria-label="Search layouts" value={query} onChange={event=>setQuery(event.target.value)}/></label><span>{layouts.length} {layouts.length===1?'layout':'layouts'}</span></div>{layoutCards(layouts)}{query&&!layouts.length&&<p className="no-results">No layouts match “{query}”.</p>}</>:<div className="empty-state"><Grid2X2 size={28}/><h3>No layouts yet</h3><p>Create a layout or scan your room.</p></div>}</>}
      </>}
    </main></div>
    {preview&&<Suspense fallback={<Modal label="Loading preview" onClose={()=>setPreview(null)} className="small-modal"><div className="workspace-loading"><span className="loading-ring"/>Opening product preview…</div></Modal>}><PreviewModal key={preview.id} item={preview} layouts={workspace.layouts} onVariant={id=>setPreview(current=>current?.product?selectItemVariant(current,id):current)} onGenerate={generateModel} onCheckModel={checkModel} modelJob={jobs.find(job=>job.asin===preview.listing?.asin)} onAdd={addToRoom} onNew={()=>{const item=preview;setPreview(null);startRoom(item);}} onClose={()=>setPreview(null)} onUnavailable={()=>setPhone(true)} unit={unit} onUnit={value=>{setUnit(value);writeUnit(value);}}/></Suspense>}
    {jobsOpen&&<ModelJobsPanel jobs={jobs} onClose={()=>setJobsOpen(false)} onOpen={item=>{setJobsOpen(false);openPreview(item);}} onCheck={asin=>manager.check(asin)}/>}
    {scanOpen&&<RoomScanImport initialError={scanError} onClose={()=>{setScanOpen(false);setScanError(undefined);setPendingItem(null);}} onBack={()=>{setScanOpen(false);setScanError(undefined);setCreateOpen(true);}} onImport={scan=>finishScan(scan,pendingItem??undefined)}/>}
    {createOpen&&<NewLayout onClose={()=>{setCreateOpen(false);setPendingItem(null);}} onCreate={createRoom} onScan={()=>{setCreateOpen(false);setScanError(undefined);setScanOpen(true);}}/>}
    {(help||phone)&&<Modal label={phone?'Use AR on your phone':'Help'} onClose={()=>{setHelp(false);setPhone(false);setCopied(false);}} className="small-modal"><div className="modal-form"><h2>{phone?'Use AR on your phone':'Help'}</h2>{phone?<><p>Open this site in Safari on an iPhone or Chrome on an AR-capable Android phone. Choose a product or layout, then tap the AR button.</p><div className="notice">Allow camera access and slowly scan a well-lit floor. Drag to move and use two fingers to rotate. Scaling stays locked.</div><button className="button primary" onClick={async()=>{try{await navigator.clipboard.writeText(window.location.href);setCopied(true);}catch{notify('Copy this page’s address from your browser.');}}}>{copied?<Check size={16}/>:<Link2 size={16}/>} {copied?'Link copied':'Copy site link'}</button></>:<><div className="help-option"><Armchair size={18}/><div><h3>Check one product</h3><p>Search or paste an Amazon link. Preview a 3D model or add it to a layout.</p></div></div><div className="help-option"><Layers size={18}/><div><h3>Plan a whole room</h3><p>Enter room dimensions or import a scan. Add furniture, drag it into place, and preview in AR.</p></div></div><div className="help-option"><Camera size={18}/><div><h3>Photo to 3D</h3><p>Take or upload a photo. Generate a model and enter its real height for AR.</p></div></div><button className="button secondary" onClick={()=>{setHelp(false);setPhone(true);}}>Using AR on your phone</button></>}<p className="help-fineprint">Layouts stay in this browser and don’t sync across devices. AR needs a compatible phone. Measure to confirm fit.</p></div></Modal>}
    {toast&&<div className="toast" role="status"><Check size={16}/><span>{toast.message}</span>{toast.undo&&<button onClick={()=>{toast.undo?.();setToast(null);}}>Undo</button>}<button aria-label="Dismiss notification" onClick={()=>setToast(null)}><X size={15}/></button></div>}
  </div>;
}
