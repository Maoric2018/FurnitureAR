import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Armchair, Check, ChevronRight, Copy, Grid2X2, HelpCircle, Home, Layers, LayoutGrid, Link2, MonitorSmartphone, Plus, ScanLine, Search, Trash2, X } from 'lucide-react';
import type { ProductItem, RoomLayout } from './lib/workspace';
import { createLayout, duplicateLayout, readWorkspace, relativeDate, saveWorkspace, selectItemVariant } from './lib/workspace';
import { readUnit, writeUnit } from './lib/storage';
import type { Unit } from './lib/products';
import Modal from './components/Modal';
import LinkInput from './components/LinkInput';
import FloorPlan from './components/FloorPlan';
import NewLayout from './components/NewLayout';
import RoomScanImport from './components/RoomScanImport';
import { readRoomScanFragment } from './lib/room-scan';
const PreviewModal=lazy(()=>import('./components/PreviewModal'));
const RoomEditor=lazy(()=>import('./components/RoomEditor'));

type Page='home'|'layouts';
export default function App(){
  const [workspace,setWorkspace]=useState(readWorkspace),[persisted,setPersisted]=useState(true);
  const [incomingScan,setIncomingScan]=useState(()=>{try{return {scan:readRoomScanFragment(window.location.hash),error:undefined};}catch(error){return {scan:undefined,error:(error as Error).message};}});
  const [scanOpen,setScanOpen]=useState(!!incomingScan.scan||!!incomingScan.error);
  useEffect(()=>{
    const receiveScan=()=>{
      if(!window.location.hash.startsWith('#room-scan='))return;
      try{setIncomingScan({scan:readRoomScanFragment(window.location.hash),error:undefined});}
      catch(error){setIncomingScan({scan:undefined,error:(error as Error).message});}
      setCreateOpen(false);setPreview(null);setScanOpen(true);
      window.history.replaceState(null,'',window.location.pathname+window.location.search);
    };
    receiveScan();window.addEventListener('hashchange',receiveScan);
    return()=>window.removeEventListener('hashchange',receiveScan);
  },[]);
  const [page,setPage]=useState<Page>('home'),[roomId,setRoomId]=useState<string|null>(null),[query,setQuery]=useState('');
  const [preview,setPreview]=useState<ProductItem|null>(null),[createOpen,setCreateOpen]=useState(false);
  const [unit,setUnit]=useState<Unit>(readUnit),[help,setHelp]=useState(false),[phone,setPhone]=useState(false),[copied,setCopied]=useState(false);
  const [toast,setToast]=useState<{message:string;undo?:()=>void}|null>(null);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{setPersisted(saveWorkspace(workspace));},[workspace]);
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
  const notify=(message:string,undo?:()=>void)=>{setToast({message,undo});if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setToast(null),6000);};
  const navigate=(next:Page)=>{setPage(next);setRoomId(null);setQuery('');window.scrollTo({top:0});};
  const openRoom=(id:string)=>{setRoomId(id);setPage('layouts');window.scrollTo({top:0});};
  const updateRoom=(room:RoomLayout)=>setWorkspace(current=>({...current,layouts:current.layouts.map(item=>item.id===room.id?room:item)}));
  const removeRoom=(room:RoomLayout)=>{setWorkspace(current=>({...current,layouts:current.layouts.filter(item=>item.id!==room.id)}));notify('Layout deleted.',()=>setWorkspace(current=>({...current,layouts:[room,...current.layouts]})));};
  const room=workspace.layouts.find(item=>item.id===roomId);
  const layouts=[...workspace.layouts].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).filter(item=>`${item.name} ${item.roomType}`.toLowerCase().includes(query.toLowerCase()));
  const startRoom=()=>setCreateOpen(true);
  const createRoom=(created:RoomLayout)=>{
    setWorkspace(current=>({...current,layouts:[created,...current.layouts]}));
    setCreateOpen(false);setScanOpen(false);setIncomingScan({scan:undefined,error:undefined});openRoom(created.id);
  };
  const layoutCards=(items:RoomLayout[])=><div className="layout-grid">{items.map(item=><article className="layout-card" key={item.id}><button className="layout-card-plan" onClick={()=>openRoom(item.id)} aria-label={`Open ${item.name}`}><FloorPlan layout={item} compact/><span className="room-type-tag">{item.roomType}</span><span className="open-layout-arrow"><ArrowUpRight size={17}/></span></button><div className="layout-card-info"><button onClick={()=>openRoom(item.id)}><h3>{item.name}</h3><p>{item.items.length} {item.items.length===1?'piece':'pieces'}<span>·</span>Edited {relativeDate(item.updatedAt).toLowerCase()}</p></button><div className="card-actions"><button className="icon-button" aria-label={`Duplicate ${item.name}`} onClick={()=>{const copy=duplicateLayout(item);setWorkspace(current=>({...current,layouts:[copy,...current.layouts]}));notify('Layout duplicated.');}}><Copy size={14}/></button><button className="icon-button" aria-label={`Delete ${item.name}`} onClick={()=>removeRoom(item)}><Trash2 size={14}/></button></div></div></article>)}<button className="new-layout-card" onClick={()=>startRoom()}><span><Plus size={23}/></span><strong>Create a layout</strong><p>A fresh start for any room.</p></button></div>;
  return <div className="app-shell"><a href="#main-content" className="skip-link">Skip to workspace</a>
    <aside className="sidebar"><a className="brand" href="#" onClick={event=>{event.preventDefault();navigate('home');}} aria-label="Furniture AR home"><span className="brand-symbol"><span/><span/><span/></span><span>furniture<span className="ar-word">AR</span><span className="brand-square"/></span></a><span className="nav-caption">WORKSPACE</span><nav aria-label="Main navigation">{([{id:'home',label:'Overview',icon:Home},{id:'layouts',label:'My layouts',icon:Layers}] as const).map(({id,label,icon:Icon})=><button key={id} className={`side-link ${page===id?'active':''}`} aria-current={page===id?'page':undefined} onClick={()=>navigate(id)}><Icon size={18}/><span>{label}</span>{id==='layouts'&&workspace.layouts.length>0&&<small>{workspace.layouts.length}</small>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-tip"><span className="corner-mark"><ScanLine size={23}/></span><strong>A better view, on your phone.</strong><p>Place your pieces in the room with augmented reality.</p><button onClick={()=>setPhone(true)}>Open on mobile <ArrowUpRight size={13}/></button></div><button className="support-link" onClick={()=>setHelp(true)}><HelpCircle size={17}/>How it works<ArrowUpRight size={13}/></button><div className="workspace-status"><span className={persisted?'online-dot':'offline-dot'}/>{persisted?'Saved on this device':'Browser storage unavailable'}</div></div>
    </aside>
    <div className="app-main"><header className="topbar"><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={12}/><strong>{room?room.name:page==='home'?'Overview':'My layouts'}</strong></div><div className="topbar-actions"><button className="topbar-help" onClick={()=>setHelp(true)}>Getting started<ArrowUpRight size={13}/></button></div></header><main id="main-content" className={room?'main-content editor-content':'main-content'}>
      {room?<Suspense fallback={<div className="workspace-loading"><span className="loading-ring"/>Opening your layout…</div>}><RoomEditor key={room.id} layout={room} onChange={updateRoom} onBack={()=>navigate('layouts')} onUnavailable={()=>setPhone(true)} onNotify={notify} persisted={persisted} onPreview={setPreview}/></Suspense>:<>
        {page==='home'&&<><div className="page-heading"><div><div className="overline">MAKE YOURSELF AT HOME</div><h1>A little planning.<br/>A place that feels like you.</h1><p>Try a single piece. Or bring a whole room together.</p></div><span className="heading-coordinate"><ArrowDownLeft size={20}/><span>YOUR SPACE.<br/>YOUR PERSPECTIVE.</span></span></div>
          <div className="start-grid"><section className="quick-start"><div className="mode-label"><span className="mode-icon"><Armchair size={20}/></span><span>ONE PRODUCT</span><span className="mode-index">01</span></div><h2>Will it work <br/>in my room?</h2><p>Search Amazon or paste a link. <br/>Find your piece. Find the right spot.</p><LinkInput onProduct={setPreview}/><div className="input-help"><Search size={12}/>Browse Amazon finds, then preview a matching 3D model.</div></section><section className="room-start"><img src="/images/room.jpg" alt="A bright living room with natural wood furniture and a neutral sofa"/><div className="room-photo-shade"/><div className="mode-label"><span className="mode-icon"><LayoutGrid size={20}/></span><span>A WHOLE ROOM</span><span className="mode-index">02</span></div><div className="room-start-copy"><span className="room-caption">SEE THE BIGGER PICTURE</span><h2>Good pieces.<br/>Better together.</h2><p>Create a floor plan. Arrange your furniture.<br/>Then see it all in your space.</p><div className="room-start-actions"><button className="button light" onClick={()=>startRoom()}>Create a layout<Plus size={17}/></button></div></div><span className="photo-edge-label">ROOM FOR YOUR IDEAS</span></section></div>
          <section className="saved-layouts-section"><div className="section-heading"><div><h2>Your layouts <span>{workspace.layouts.length.toString().padStart(2,'0')}</span></h2><p>Pick up where you left off.</p></div><button className="text-button" onClick={()=>navigate('layouts')}>View all layouts<ArrowRight size={15}/></button></div>{workspace.layouts.length?layoutCards(layouts.slice(0,2)):<div className="empty-layout-row"><span className="empty-plan-icon"><Grid2X2 size={26}/></span><div><h3>Your first room starts here.</h3><p>Keep a few ideas together. Move things around. Come back anytime.</p></div><button className="button outlined" onClick={()=>startRoom()}><Plus size={15}/>New layout</button></div>}</section>
          <div className="workspace-footer"><span><MonitorSmartphone size={14}/>Plan here. Preview in your room on your phone.</span><button onClick={()=>setHelp(true)}>How AR works<ArrowUpRight size={12}/></button></div>
        </>}
        {page==='layouts'&&<><div className="page-heading list-page-heading"><div><div className="overline">YOUR ROOMS, YOUR IDEAS</div><h1>My layouts</h1><p>A place for every version of your room.</p></div><div className="layout-heading-actions"><button className="button primary" onClick={()=>startRoom()}><Plus size={17}/>New layout</button></div></div><div className="list-toolbar"><span>{layouts.length} {layouts.length===1?'layout':'layouts'}</span><label className="search-field"><Search size={16}/><input placeholder="Search layouts" aria-label="Search layouts" value={query} onChange={event=>setQuery(event.target.value)}/></label></div>{layoutCards(layouts)}{query&&!layouts.length&&<p className="no-results">No layouts match “{query}”.</p>}<div className="storage-note"><Check size={13}/>Your layouts save automatically in this browser.</div></>}
      </>}
    </main></div>
    {preview&&<Suspense fallback={<Modal label="Loading preview" onClose={()=>setPreview(null)} className="small-modal"><div className="workspace-loading"><span className="loading-ring"/>Opening product preview…</div></Modal>}><PreviewModal item={preview} onVariant={id=>setPreview(current=>current?.product?selectItemVariant(current,id):current)} onClose={()=>setPreview(null)} onUnavailable={()=>setPhone(true)} unit={unit} onUnit={value=>{setUnit(value);writeUnit(value);}}/></Suspense>}
    {scanOpen&&<RoomScanImport initial={incomingScan.scan} initialError={incomingScan.error} onClose={()=>{setScanOpen(false);setIncomingScan({scan:undefined,error:undefined});}} onImport={scan=>createRoom({...createLayout(scan.name,'Scanned room',scan.width,scan.depth),survey:scan.survey})}/>}
    {createOpen&&<NewLayout onClose={()=>setCreateOpen(false)} onCreate={createRoom}/>}
    {(help||phone)&&<Modal label={phone?'Preview on your phone':'How Furniture AR works'} onClose={()=>{setHelp(false);setPhone(false);setCopied(false);}} className="small-modal"><div className="modal-form help-content"><span className="modal-symbol"><ScanLine size={26}/></span><span className="overline">FROM PLAN TO PLACE</span><h2>{phone?'Take it into your room.':'Two ways to find your fit.'}</h2>{phone?<><p>Open this site in Safari on an iPhone or Chrome on an AR-capable Android phone. Choose a product or layout, then tap the AR button.</p><div className="help-note">Allow camera access and slowly scan a well-lit floor. Drag to move and use two fingers to rotate. Scaling stays locked.</div><button className="button primary" onClick={async()=>{try{await navigator.clipboard.writeText(window.location.href);setCopied(true);}catch{notify('Copy this page’s address from your browser.');}}}>{copied?<Check size={16}/>:<Link2 size={16}/>} {copied?'Link copied':'Copy link for your phone'}</button></>:<><div className="help-option"><Armchair size={23}/><div><h3>Check one product</h3><p>Search Amazon or paste a link, inspect a matching model, and place it in your room. Choose a finish and see how it looks at actual scale.</p></div></div><div className="help-option"><Layers size={23}/><div><h3>Plan a whole room</h3><p>Enter your room dimensions, then add Amazon products and arrange them on the floor plan. Room scanning is coming to the app. Your layout saves automatically.</p></div></div><button className="button primary" onClick={()=>{setHelp(false);setPhone(true);}}>Using AR on your phone<ArrowUpRight size={16}/></button></>}<p className="help-fineprint">AR needs a compatible phone and HTTPS. Layouts save on this device; they don’t sync between devices yet. Use a tape measure to confirm fit before buying.</p></div></Modal>}
    {toast&&<div className="toast" role="status"><Check size={16}/><span>{toast.message}</span>{toast.undo&&<button onClick={()=>{toast.undo?.();setToast(null);}}>Undo</button>}<button aria-label="Dismiss notification" onClick={()=>setToast(null)}><X size={15}/></button></div>}
  </div>;
}
