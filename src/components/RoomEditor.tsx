import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Armchair, Box, Check, ChevronDown, Copy, ExternalLink, Grid2X2, Maximize2, Magnet, Redo2, RotateCcw, RotateCw, Trash2, Undo2, ScanLine, TriangleAlert } from 'lucide-react';
import type { PlacedItem, ProductItem, RoomLayout } from '../lib/workspace';
import { availableItemVariants, clampPlacement, duplicatePlacedItem, placeItem, selectItemVariant, sourceLabel } from '../lib/workspace';
import FloorPlan from './FloorPlan';
import LayoutViewer from './LayoutViewer';
import LinkInput from './LinkInput';
import Modal from './Modal';
import ProductIcon from './ProductIcon';
import FinishPicker from './FinishPicker';
import { getVariant } from '../lib/products';
import ExistingObjects from './ExistingObjects';
import { placementWarnings } from '../lib/room-scan';
interface Props {layout:RoomLayout;onChange:(layout:RoomLayout)=>void;onBack:()=>void;onUnavailable:()=>void;onNotify:(message:string)=>void;persisted:boolean;onPreview:(item:ProductItem)=>void}
export default function RoomEditor({layout,onChange,onBack,onUnavailable,onNotify,persisted,onPreview}:Props){
  const [view,setView]=useState<'plan'|'3d'>('plan'),[selectedId,setSelectedId]=useState<string|undefined>(layout.items[0]?.id);
  const [history,setHistory]=useState<RoomLayout[]>([]),[future,setFuture]=useState<RoomLayout[]>([]),[showSize,setShowSize]=useState(false);
  const [snap,setSnap]=useState(true);
  const [nameDraft,setNameDraft]=useState(layout.name);
  const [selectedObstacleId,setSelectedObstacleId]=useState<string>();
  const warnings=layout.items.flatMap((item,index)=>placementWarnings(item,layout).map(message=>`Piece ${index+1}: ${message}`));
  useEffect(()=>setNameDraft(layout.name),[layout.name]);
  const selected=layout.items.find(item=>item.id===selectedId);
  const selectedVariants=selected?availableItemVariants(selected):[];
  const currentVariant=selected?getVariant(selected.product,selected.variantId):undefined;
  const selectedVariant=selectedVariants.find(variant=>variant.id===currentVariant?.id)??currentVariant;
  const update=(next:RoomLayout)=>onChange({...next,updatedAt:new Date().toISOString()});
  const commit=(next:RoomLayout)=>{
    if(JSON.stringify({...next,updatedAt:''})===JSON.stringify({...layout,updatedAt:''}))return;
    setHistory(value=>[...value.slice(-29),structuredClone(layout)]);setFuture([]);update(next);
  };
  const undo=()=>{const previous=history.at(-1);if(previous){setHistory(value=>value.slice(0,-1));setFuture(value=>[...value,structuredClone(layout)]);update(previous);}};
  const redo=()=>{const next=future.at(-1);if(next){setFuture(value=>value.slice(0,-1));setHistory(value=>[...value,structuredClone(layout)]);update(next);}};
  const changeItem=(item:PlacedItem)=>commit({...layout,items:layout.items.map(current=>current.id===item.id?clampPlacement(item,layout):current)});
  const commitPosition=(axis:'x'|'z',input:HTMLInputElement)=>{
    if(!selected)return;
    const value=Number(input.value);
    const changed=input.value.trim()&&Number.isFinite(value)&&value!==Number(selected[axis].toFixed(3));
    const next=changed?clampPlacement({...selected,[axis]:value},layout):selected;
    if(changed)changeItem(next);
    input.value=String(Number(next[axis].toFixed(3)));
  };
  const removeSelected=()=>{if(selected){commit({...layout,items:layout.items.filter(item=>item.id!==selected.id)});setSelectedId(undefined);}};
  const add=(item:ProductItem)=>{
    if(!item.product){onPreview(item);return;}
    try{const next=placeItem(layout,item);commit(next);setSelectedId(next.items.at(-1)!.id);setSelectedObstacleId(undefined);setView('plan');onNotify('Product added to layout.');}catch(error){onNotify((error as Error).message);}
  };
  const duplicateSelected=()=>{
    if(!selected)return;
    try{const next=duplicatePlacedItem(layout,selected);commit(next);setSelectedId(next.items.at(-1)!.id);onNotify('Piece duplicated.');}catch(error){onNotify((error as Error).message);}
  };
  return <div className="room-editor" onKeyDown={event=>{
    const target=event.target as HTMLElement;
    if(target.closest('input,textarea,select,[contenteditable="true"]')||showSize)return;
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)redo();else undo();}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='y'){event.preventDefault();redo();}
  }}>
    <div className="editor-heading"><div className="editor-title"><button className="icon-button" aria-label="Back to layouts" onClick={onBack}><ArrowLeft size={20}/></button><div><input aria-label="Layout name" value={nameDraft} onChange={event=>setNameDraft(event.target.value)} maxLength={80} onBlur={event=>{const name=event.target.value.trim();if(name&&name!==layout.name)commit({...layout,name});else setNameDraft(layout.name);}}/><span>{layout.roomType}<span>·</span>{persisted?<><Check size={11}/>Saved on this device</>:'Unsaved changes — storage unavailable'}</span></div></div><button className="button primary" disabled={!layout.items.length} onClick={()=>setView('3d')}>Preview layout<ArrowUpRight size={17}/></button></div>
    {layout.survey&&<div className="room-scan-bar"><span><ScanLine size={16}/>Room scanned · {layout.survey.obstacles.length} existing objects</span><span className="scan-paused">Scanning returns in the app</span></div>}
    <div className="editor-workspace"><section className="plan-workspace"><div className="plan-toolbar"><div className="view-tabs"><button className={view==='plan'?'active':''} onClick={()=>setView('plan')}><Grid2X2 size={15}/>Floor plan</button><button className={view==='3d'?'active':''} onClick={()=>setView('3d')} disabled={!layout.items.length}><Box size={15}/>3D & AR</button></div><div className="plan-actions"><button className="icon-button" aria-label="Undo layout change" disabled={!history.length} title="Undo (⌘/Ctrl Z)" onClick={undo}><Undo2 size={17}/></button><button className="icon-button" aria-label="Redo layout change" title="Redo (⌘/Ctrl Shift Z)" disabled={!future.length} onClick={redo}><Redo2 size={17}/></button><button className="room-size-button" title={layout.survey?"Bounds from your room scan":"Edit room dimensions"} disabled={!!layout.survey} onClick={()=>setShowSize(true)}><Maximize2 size={14}/>{Number(layout.width.toFixed(2))} × {Number(layout.depth.toFixed(2))} m{!layout.survey&&<ChevronDown size={13}/>}</button></div></div>
      {layout.survey&&view==='plan'&&<div className="plan-legend"><span><i className="existing-swatch"/>Existing furniture</span><span><i className="new-piece-swatch"/>New products</span><span>Scan estimates · verify fit</span></div>}
      {view==='plan'&&<div className="arrange-toolbar">
        <div className="arrange-selection">{selected?<><strong>Piece {layout.items.findIndex(item=>item.id===selected.id)+1}</strong><span>{selected.name}</span></>:<span>Select a piece to arrange it</span>}</div>
        <div className="arrange-actions">
          <button className={`snap-toggle ${snap?'active':''}`} aria-pressed={snap} title="Snap to a 5 cm grid. Hold Shift while dragging to move freely." onClick={()=>setSnap(value=>!value)}><Magnet size={16}/><span>Snap</span></button>
          <span className="action-divider"/>
          <button aria-label="Rotate selected piece left" title="Rotate left 15°" disabled={!selected} onClick={()=>selected&&changeItem({...selected,rotation:selected.rotation-15})}><RotateCcw size={18}/></button>
          <button aria-label="Rotate selected piece right" title="Rotate right 15°" disabled={!selected} onClick={()=>selected&&changeItem({...selected,rotation:selected.rotation+15})}><RotateCw size={18}/></button>
          <button aria-label="Duplicate selected piece" title="Duplicate piece" disabled={!selected} onClick={duplicateSelected}><Copy size={17}/></button>
          <button aria-label="Remove selected piece" title="Remove piece" disabled={!selected} onClick={removeSelected}><Trash2 size={17}/></button>
        </div>
      </div>}
      <div className="plan-canvas">{view==='plan'?<FloorPlan layout={layout} selectedId={selectedId} onSelect={id=>{setSelectedId(id);setSelectedObstacleId(undefined);}} onMove={changeItem} snap={snap} onDeselect={()=>{setSelectedId(undefined);setSelectedObstacleId(undefined);}} selectedObstacleId={selectedObstacleId} onSelectObstacle={id=>{setSelectedObstacleId(id);setSelectedId(undefined);}}/>:<LayoutViewer layout={layout} onUnavailable={onUnavailable}/>}</div>
      {!!warnings.length&&<div className="overlap-notice" role="status"><TriangleAlert size={16}/><div><strong>Check this placement</strong>{warnings.slice(0,3).map((message,i)=><p key={i}>{message}</p>)}{warnings.length>3&&<p>And {warnings.length-3} more placement warnings.</p>}</div></div>}
      <div className="plan-footer"><span>{view==='plan'?snap?'Drag to move · snaps every 5 cm.':'Drag to move · free placement.':'Drag to orbit. Scroll or pinch to zoom.'}</span><span>{layout.items.length} {layout.items.length===1?'piece':'pieces'}<i/>To scale</span></div>
    </section><aside className="layout-inspector"><div className="inspector-header"><h2>In this layout<span>{layout.items.length}</span></h2><p>Build your room, one piece at a time.</p></div><div className="inspector-import"><LinkInput compact onProduct={add} buttonLabel="Add product to layout"/></div>
      <div className="layout-item-list">{layout.items.length?layout.items.map((item,index)=><button key={item.id} className={`layout-item ${selectedId===item.id?'selected':''}`} onClick={()=>{setSelectedId(item.id);setSelectedObstacleId(undefined);setView('plan');}}><span className="item-mini"><ProductIcon category={item.product.category} size={23}/><small>{index+1}</small></span><span><strong>{item.name}</strong><small>{getVariant(item.product,item.variantId).name} · {sourceLabel(item.sourceUrl)}</small></span><span className="selection-indicator"/></button>):<div className="inspector-empty"><Armchair size={32}/><strong>No pieces yet</strong><p>Search Amazon or paste a link to find your first piece.</p></div>}</div>
      {selected&&<div className="item-properties"><div className="property-heading"><h3>Selected piece</h3><a href={selectedVariant?.productUrl??selected.sourceUrl} target="_blank" rel="noreferrer" aria-label="Open selected product color"><ExternalLink size={14}/></a></div><label className="field-label">Name<input value={selected.name} maxLength={60} onChange={event=>changeItem({...selected,name:event.target.value||selected.product.name})}/></label><FinishPicker variants={selectedVariants} selected={selectedVariant!} onChange={id=>changeItem(selectItemVariant(selected,id))} listing={selected.listing}/><div className="position-controls"><label className="field-label">X position (m)<input key={`${selected.id}-x-${selected.x}`} aria-label="Horizontal position" type="number" step=".05" defaultValue={Number(selected.x.toFixed(3))} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}} onBlur={event=>commitPosition('x',event.currentTarget)}/></label><label className="field-label">Y position (m)<input key={`${selected.id}-z-${selected.z}`} aria-label="Vertical position" type="number" step=".05" defaultValue={Number(selected.z.toFixed(3))} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}} onBlur={event=>commitPosition('z',event.currentTarget)}/></label></div><p className="position-hint">From the room center. Arrow keys move 5 cm; Shift + arrows move 25 cm. R rotates.</p><div className="rotation-control"><span>Rotation</span><button className="icon-button" aria-label="Rotate piece 15 degrees" onClick={()=>changeItem({...selected,rotation:selected.rotation+15})}><RotateCw size={16}/></button><select aria-label="Piece rotation" value={selected.rotation} onChange={event=>changeItem({...selected,rotation:Number(event.target.value)})}>{Array.from({length:24},(_,index)=>index*15).map(angle=><option key={angle} value={angle}>{angle}°</option>)}</select></div><div className="piece-actions"><button onClick={duplicateSelected}><Copy size={14}/>Duplicate</button><button onClick={removeSelected}><Trash2 size={14}/>Remove</button></div></div>}
      {layout.survey&&<ExistingObjects survey={layout.survey} selectedId={selectedObstacleId} onSelect={id=>{setSelectedObstacleId(id);setSelectedId(undefined);setView('plan');}} onChange={survey=>commit({...layout,survey})}/>}
      <p className="inspector-note">{layout.survey?'Scanned objects are estimates. The floor plan shows them as fixed obstacles; AR previews only your new products.':'Amazon details import live. Only products with a matching 3D model can be placed.'}</p>
    </aside></div>
    {showSize&&<Modal label="Room dimensions" onClose={()=>setShowSize(false)} className="small-modal"><form className="modal-form" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);const width=Number(data.get('width')),depth=Number(data.get('depth'));if(![width,depth].every(value=>Number.isFinite(value)&&value>=1&&value<=20))return;const next={...layout,width,depth};commit({...next,items:layout.items.map(item=>clampPlacement(item,next))});setShowSize(false);}}><span className="overline">LAYOUT SETTINGS</span><h2>Room dimensions</h2><p>Use your room’s measurements to plan the spacing.</p><div className="two-fields"><label className="field-label">Width (m)<input name="width" type="number" min="1" max="20" step="any" defaultValue={layout.width} required/></label><label className="field-label">Depth (m)<input name="depth" type="number" min="1" max="20" step="any" defaultValue={layout.depth} required/></label></div><button className="button primary" type="submit">Update room</button></form></Modal>}
  </div>;
}
