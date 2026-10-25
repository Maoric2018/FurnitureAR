import { useEffect, useState } from 'react';
import { ArrowLeft, Armchair, Box, Check, ChevronDown, Copy, ExternalLink, Grid2X2, Maximize2, Magnet, Plus, Redo2, RotateCcw, RotateCw, Trash2, Undo2, ScanLine, TriangleAlert, Wand2 } from 'lucide-react';
import type { PlacedItem, ProductItem, RoomLayout } from '../lib/workspace';
import { availableItemVariants, clampPlacement, duplicatePlacedItem, placeItem, selectItemVariant, sourceLabel, placementElevationLimit, isUrbanLayout } from '../lib/workspace';
import FloorPlan from './FloorPlan';
import RoomDesigner from './RoomDesigner';
import LayoutViewer from './LayoutViewer';
import LinkInput from './LinkInput';
import Modal from './Modal';
import ProductIcon from './ProductIcon';
import FinishPicker from './FinishPicker';
import { getVariant } from '../lib/products';
import ExistingObjects from './ExistingObjects';
import { placementWarnings } from '../lib/room-scan';
import type { RoomObstacle } from '../lib/room-scan';
import { hasNativeRoomAR } from '../lib/native-room';
interface Props {layout:RoomLayout;onChange:(layout:RoomLayout)=>void;onBack:()=>void;onUnavailable:()=>void;onNotify:(message:string)=>void;persisted:boolean;onPreview:(item:ProductItem)=>void;onCreateDesign:(layout:RoomLayout)=>void;onScan:()=>void}
export default function RoomEditor({layout,onChange,onBack,onUnavailable,onNotify,persisted,onPreview,onCreateDesign,onScan}:Props){
  const [view,setView]=useState<'plan'|'3d'>(()=>isUrbanLayout(layout)&&layout.items.length?'3d':'plan'),[selectedId,setSelectedId]=useState<string|undefined>(layout.items[0]?.id);
  const [history,setHistory]=useState<RoomLayout[]>([]),[future,setFuture]=useState<RoomLayout[]>([]),[showSize,setShowSize]=useState(false);
  const [snap,setSnap]=useState(true);
  const [designOpen,setDesignOpen]=useState(()=>{const params=new URLSearchParams(window.location.search);return params.get('layout')===layout.id&&params.get('design')==='1';});
  useEffect(()=>{
    const url=new URL(window.location.href);
    if(url.searchParams.get('layout')!==layout.id)return;
    url.searchParams.delete('layout');url.searchParams.delete('design');
    window.history.replaceState(null,'',url.pathname+url.search+url.hash);
  },[layout.id]);
  const [nameDraft,setNameDraft]=useState(layout.name);
  const [selectedObstacleId,setSelectedObstacleId]=useState<string|undefined>(layout.items.length?undefined:layout.survey?.obstacles[0]?.id);
  const warnings=layout.items.flatMap((item,index)=>placementWarnings(item,layout).map(message=>`Piece ${index+1}: ${message}`));
  useEffect(()=>setNameDraft(layout.name),[layout.name]);
  const selected=layout.items.find(item=>item.id===selectedId);
  const selectedObstacle=layout.survey?.obstacles.find(o=>o.id===selectedObstacleId);
  const outlineIndex=layout.survey?.obstacles.findIndex(o=>o.id===selectedObstacleId)??-1;
  const pieceCount=layout.items.length+(layout.survey?.obstacles.length??0);
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
  const changeObstacle=(obstacle:RoomObstacle)=>{
    if(!layout.survey)return;
    commit({...layout,survey:{...layout.survey,obstacles:layout.survey.obstacles.map(current=>current.id===obstacle.id?obstacle:current)}});
  };
  const addOutline=(source?:RoomObstacle)=>{
    if(!layout.survey||layout.survey.obstacles.length>=200)return;
    const outline:RoomObstacle=source?{...source,id:crypto.randomUUID()}:
      {id:crypto.randomUUID(),name:'Existing furniture',category:'other',x:0,z:0,width:1,depth:.6,height:.8,rotation:0,confidence:'unknown'};
    commit({...layout,survey:{...layout.survey,obstacles:[...layout.survey.obstacles,outline]}});
    setSelectedObstacleId(outline.id);setSelectedId(undefined);setView('plan');
  };
  const rotateSelected=(angle:number)=>{
    if(selected)changeItem({...selected,rotation:selected.rotation+angle});
    else if(selectedObstacle)changeObstacle({...selectedObstacle,rotation:((selectedObstacle.rotation+angle)%360+360)%360});
  };
  const removeSelected=()=>{
    if(selected){commit({...layout,items:layout.items.filter(item=>item.id!==selected.id)});setSelectedId(undefined);}
    else if(selectedObstacle&&layout.survey){commit({...layout,survey:{...layout.survey,obstacles:layout.survey.obstacles.filter(o=>o.id!==selectedObstacle.id)}});setSelectedObstacleId(undefined);}
  };
  const add=(item:ProductItem)=>{
    if(!item.product){onPreview(item);return;}
    try{const next=placeItem(layout,item);commit(next);setSelectedId(next.items.at(-1)!.id);setSelectedObstacleId(undefined);setView('plan');onNotify('Product added to layout.');}catch(error){onNotify((error as Error).message);}
  };
  const duplicateSelected=()=>{
    if(selectedObstacle){addOutline(selectedObstacle);return;}
    if(!selected)return;
    try{const next=duplicatePlacedItem(layout,selected);commit(next);setSelectedId(next.items.at(-1)!.id);onNotify('Piece duplicated.');}catch(error){onNotify((error as Error).message);}
  };
  return <div className="room-editor" onKeyDown={event=>{
    const target=event.target as HTMLElement;
    if(target.closest('input,textarea,select,[contenteditable="true"]')||showSize||designOpen)return;
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)redo();else undo();}
    if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='y'){event.preventDefault();redo();}
  }}>
    <div className="editor-heading"><div className="editor-title"><button className="icon-button" aria-label="Back to layouts" title="Back to layouts" onClick={onBack}><ArrowLeft size={20}/></button><div><input aria-label="Layout name" value={nameDraft} onChange={event=>setNameDraft(event.target.value)} maxLength={80} onBlur={event=>{const name=event.target.value.trim();if(name&&name!==layout.name)commit({...layout,name});else setNameDraft(layout.name);}}/><span className="editor-meta">{layout.roomType}<span className="meta-separator">·</span>{persisted?<span className="save-status" title="Saved on this device"><Check size={11}/>Saved</span>:<span className="save-warning">Not saved · storage unavailable</span>}</span></div></div><div className="editor-heading-actions"><button className="button outlined designer-trigger" onClick={()=>setDesignOpen(true)}><Wand2 size={16}/>Design my room</button><button className="button primary" disabled={!layout.items.length} onClick={()=>setView('3d')}>Preview layout</button></div></div>
    <div className="room-scan-bar"><span><ScanLine size={16}/>{layout.survey?`Room scanned · ${layout.survey.obstacles.length} furniture outlines`:"Start with your real room"}</span>{layout.survey&&<span className="scan-paused">{hasNativeRoomAR()?'Room-aligned preview available':'Room alignment in the iPhone app'}</span>}<button className="text-button" onClick={onScan}>New layout from scan</button></div>
    <div className="editor-workspace"><section className="plan-workspace"><div className="plan-toolbar"><div className="view-tabs segmented"><button className={view==='plan'?'active':''} aria-pressed={view==='plan'} onClick={()=>setView('plan')}><Grid2X2 size={15}/>Floor plan</button><button className={view==='3d'?'active':''} aria-pressed={view==='3d'} onClick={()=>setView('3d')} disabled={!layout.items.length}><Box size={15}/>3D & AR</button></div><div className="plan-actions"><button className="icon-button" aria-label="Undo layout change" disabled={!history.length} title="Undo (⌘/Ctrl Z)" onClick={undo}><Undo2 size={17}/></button><button className="icon-button" aria-label="Redo layout change" title="Redo (⌘/Ctrl Shift Z)" disabled={!future.length} onClick={redo}><Redo2 size={17}/></button><button className="room-size-button" title={layout.survey?"Bounds from your room scan":"Edit room dimensions"} disabled={!!layout.survey} onClick={()=>setShowSize(true)}><Maximize2 size={14}/>{Number(layout.width.toFixed(2))} × {Number(layout.depth.toFixed(2))} m{!layout.survey&&<ChevronDown size={13}/>}</button></div></div>
      {layout.survey&&view==='plan'&&<div className="plan-legend"><span><i className="existing-swatch"/>Existing furniture</span><span><i className="new-piece-swatch"/>New products</span><span>Check scan measurements</span></div>}
      {view==='plan'&&<div className="arrange-toolbar">
        <div className="arrange-selection">{selected?<><strong>Piece {layout.items.findIndex(item=>item.id===selected.id)+1}</strong><span>{selected.name}</span></>:selectedObstacle?<><strong>Scanned piece {outlineIndex+1}</strong><span>Furniture outline</span></>:<span>Select a piece to arrange it</span>}</div>
        <div className="arrange-actions">
          <button className={`snap-toggle ${snap?'active':''}`} aria-pressed={snap} title="Snap to a 5 cm grid. Hold Shift while dragging to move freely." onClick={()=>setSnap(value=>!value)}><Magnet size={16}/><span>Snap</span></button>
          <span className="action-divider"/>
          <button aria-label="Rotate selected piece left" title="Rotate left 15°" disabled={!selected&&!selectedObstacle} onClick={()=>rotateSelected(-15)}><RotateCcw size={18}/></button>
          <button aria-label="Rotate selected piece right" title="Rotate right 15°" disabled={!selected&&!selectedObstacle} onClick={()=>rotateSelected(15)}><RotateCw size={18}/></button>
          <button aria-label="Duplicate selected piece" title="Duplicate piece" disabled={(!selected&&!selectedObstacle)||!!selectedObstacle&&layout.survey!.obstacles.length>=200} onClick={duplicateSelected}><Copy size={17}/></button>
          <button aria-label="Remove selected piece" title="Remove piece" disabled={!selected&&!selectedObstacle} onClick={removeSelected}><Trash2 size={17}/></button>
        </div>
      </div>}
      <div className="plan-canvas">{view==='plan'?<FloorPlan layout={layout} selectedId={selectedId} onSelect={id=>{setSelectedId(id);setSelectedObstacleId(undefined);}} onMove={changeItem} snap={snap} onDeselect={()=>{setSelectedId(undefined);setSelectedObstacleId(undefined);}} selectedObstacleId={selectedObstacleId} onSelectObstacle={id=>{setSelectedObstacleId(id);setSelectedId(undefined);}} onMoveObstacle={changeObstacle}/>:<LayoutViewer layout={layout} onUnavailable={onUnavailable}/>}</div>
      {!!warnings.length&&<div className="overlap-notice notice warning" role="status"><TriangleAlert size={16}/><div><strong>Check this placement</strong>{warnings.slice(0,3).map((message,i)=><p key={i}>{message}</p>)}{warnings.length>3&&<p>And {warnings.length-3} more placement warnings.</p>}</div></div>}
      <div className="plan-footer"><span>{view==='plan'?snap?'Drag to move · snaps every 5 cm.':'Drag to move · free placement.':'Drag to rotate. Pinch or scroll to zoom.'}</span><span>{pieceCount} {pieceCount===1?'piece':'pieces'}<i/>To scale</span></div>
    </section><aside className="layout-inspector"><div className="inspector-header"><h2>In this layout<span>{pieceCount}</span></h2></div><div className="inspector-import"><LinkInput compact onProduct={add} buttonLabel="Add to layout"/>{layout.survey&&<button className="text-button" disabled={layout.survey.obstacles.length>=200} onClick={()=>addOutline()}><Plus size={14}/>Add furniture outline</button>}</div>
      <div className="layout-item-list">{layout.items.map((item,index)=><button key={item.id} className={`layout-item ${selectedId===item.id?'selected':''}`} aria-pressed={selectedId===item.id} onClick={()=>{setSelectedId(item.id);setSelectedObstacleId(undefined);setView('plan');}}><span className="item-mini"><ProductIcon category={item.product.category} size={23}/><small>{index+1}</small></span><span><strong>{item.name}</strong><small>{getVariant(item.product,item.variantId).name} · {sourceLabel(item.sourceUrl)}</small></span><span className="selection-indicator"/></button>)}{layout.survey?.obstacles.map((obstacle,index)=><button key={obstacle.id} className={`layout-item ${selectedObstacleId===obstacle.id?'selected':''}`} aria-pressed={selectedObstacleId===obstacle.id} onClick={()=>{setSelectedObstacleId(obstacle.id);setSelectedId(undefined);setView('plan');}}><span className="item-mini outline-mini"><ScanLine size={20}/></span><span><strong>Scanned piece {index+1}</strong><small>Outline · {obstacle.width.toFixed(2)} × {obstacle.depth.toFixed(2)} m{obstacle.confidence==='low'?' · Check detection':''}</small></span><span className="selection-indicator"/></button>)}{!pieceCount&&<div className="inspector-empty"><Armchair size={32}/><strong>No pieces yet</strong><p>Search or paste a product link above.</p></div>}</div>
      {selected&&<div className="item-properties"><div className="property-heading"><h3>Product details</h3><a href={selectedVariant?.productUrl??selected.sourceUrl} target="_blank" rel="noreferrer" aria-label="Open product listing" title="Open product listing"><ExternalLink size={14}/></a></div><label className="field-label">Name<input value={selected.name} maxLength={60} onChange={event=>changeItem({...selected,name:event.target.value||selected.product.name})}/></label><FinishPicker variants={selectedVariants} selected={selectedVariant!} onChange={id=>changeItem(selectItemVariant(selected,id))} listing={selected.listing}/><div className="position-controls"><label className="field-label">X position (m)<input key={`${selected.id}-x-${selected.x}`} aria-label="Horizontal position" type="number" step=".05" defaultValue={Number(selected.x.toFixed(3))} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}} onBlur={event=>commitPosition('x',event.currentTarget)}/></label><label className="field-label">Y position (m)<input key={`${selected.id}-z-${selected.z}`} aria-label="Vertical position" type="number" step=".05" defaultValue={Number(selected.z.toFixed(3))} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}} onBlur={event=>commitPosition('z',event.currentTarget)}/></label></div><p className="position-hint">From the room center. Arrow keys move 5 cm; Shift + arrows move 25 cm. R rotates.</p>{(selected.product.placementKind==='wall'||(selected.elevation??0)>0)&&<label className="field-label">Height above floor (m)<input key={`${selected.id}-elevation-${selected.elevation??0}`} aria-label="Height above floor" type="number" min="0" max={placementElevationLimit(selected.product,layout)} step=".05" defaultValue={selected.elevation??0} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}} onBlur={event=>{const input=event.currentTarget,height=Number(input.value);const next=input.value.trim()&&Number.isFinite(height)?clampPlacement({...selected,elevation:height},layout):selected;changeItem(next);input.value=String(next.elevation??0);}}/></label>}<div className="rotation-control"><span>Rotation</span><button className="icon-button" aria-label="Rotate piece 15 degrees" title="Rotate 15°" onClick={()=>changeItem({...selected,rotation:selected.rotation+15})}><RotateCw size={16}/></button><select aria-label="Piece rotation" value={selected.rotation} onChange={event=>changeItem({...selected,rotation:Number(event.target.value)})}>{Array.from({length:24},(_,index)=>index*15).map(angle=><option key={angle} value={angle}>{angle}°</option>)}</select></div><div className="piece-actions"><button className="icon-button" aria-label="Duplicate product" title="Duplicate product" onClick={duplicateSelected}><Copy size={16}/></button><button className="icon-button" aria-label="Remove product" title="Remove product" onClick={removeSelected}><Trash2 size={16}/></button></div></div>}
      {selectedObstacle&&<ExistingObjects obstacle={selectedObstacle} index={outlineIndex+1} onChange={changeObstacle} onDuplicate={layout.survey!.obstacles.length<200?duplicateSelected:undefined} onRemove={removeSelected}/>}
      <p className="inspector-note">{layout.survey?'Scanned outlines are editable. AR shows products with 3D models.':'Products need a matching 3D model for AR.'}</p>
    </aside></div>
    {designOpen&&<RoomDesigner layout={layout} onClose={()=>setDesignOpen(false)} onApply={proposal=>{setDesignOpen(false);onCreateDesign(proposal.layout);onNotify("Design saved as a new layout. Move any piece to make it yours.");}}/>}
    {showSize&&<Modal label="Room dimensions" onClose={()=>setShowSize(false)} className="small-modal"><form className="modal-form" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);const width=Number(data.get('width')),depth=Number(data.get('depth'));if(![width,depth].every(value=>Number.isFinite(value)&&value>=1&&value<=20))return;const next={...layout,width,depth};commit({...next,items:layout.items.map(item=>clampPlacement(item,next))});setShowSize(false);}}><h2>Room dimensions</h2><div className="two-fields"><label className="field-label">Width (m)<input name="width" type="number" min="1" max="20" step="any" defaultValue={layout.width} required/></label><label className="field-label">Depth (m)<input name="depth" type="number" min="1" max="20" step="any" defaultValue={layout.depth} required/></label></div><button className="button primary" type="submit">Save dimensions</button></form></Modal>}
  </div>;
}
