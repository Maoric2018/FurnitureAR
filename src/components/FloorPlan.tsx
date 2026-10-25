import { useId, useRef, useState } from 'react';
import type { PointerEvent, KeyboardEvent } from 'react';
import { clampPlacement, movePlacement } from '../lib/workspace';
import { getVariant } from '../lib/products';
import type { RoomLayout, PlacedItem } from '../lib/workspace';
import { placementWarnings, solidWallSegments } from '../lib/room-scan';
import type { RoomObstacle } from '../lib/room-scan';

interface Props { layout:RoomLayout; selectedId?:string; onSelect?:(id:string)=>void; onMove?:(item:PlacedItem)=>void; onDeselect?:()=>void; snap?:boolean; compact?:boolean; selectedObstacleId?:string; onSelectObstacle?:(id:string)=>void; onMoveObstacle?:(obstacle:RoomObstacle)=>void }
export default function FloorPlan({layout,selectedId,onSelect,onMove,onDeselect,snap=false,compact=false,selectedObstacleId,onSelectObstacle,onMoveObstacle}:Props){
  const svg=useRef<SVGSVGElement>(null);
  const drag=useRef<{pointerId:number;item:PlacedItem;offsetX:number;offsetZ:number;startX:number;startY:number;moved:boolean;next:PlacedItem}|null>(null);
  const [draft,setDraft]=useState<PlacedItem|null>(null);
  const outlineDrag=useRef<{pointerId:number;item:RoomObstacle;offsetX:number;offsetZ:number;startX:number;startY:number;moved:boolean;next:RoomObstacle}|null>(null);
  const [outlineDraft,setOutlineDraft]=useState<RoomObstacle|null>(null);
  const pattern=useId().replace(/:/g,'');
  const padding=.65, w=layout.width,h=layout.depth;
  const displayed={...layout,
    items:draft?layout.items.map(item=>item.id===draft.id?draft:item):layout.items,
    ...(layout.survey?{survey:outlineDraft?{...layout.survey,obstacles:layout.survey.obstacles.map(o=>o.id===outlineDraft.id?outlineDraft:o)}:layout.survey}:{})};
  const point=(event:PointerEvent)=>{
    const element=svg.current!,point=element.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
    return point.matrixTransform(element.getScreenCTM()!.inverse());
  };
  const start=(event:PointerEvent<SVGGElement>,item:PlacedItem)=>{
    if(!onMove||event.button!==0||drag.current||outlineDrag.current)return;
    event.preventDefault();event.stopPropagation();event.currentTarget.focus({preventScroll:true});
    event.currentTarget.setPointerCapture(event.pointerId);onSelect?.(item.id);
    const p=point(event);drag.current={pointerId:event.pointerId,item,offsetX:p.x-item.x,offsetZ:p.y-item.z,startX:event.clientX,startY:event.clientY,moved:false,next:item};
  };
  const moveOutline=(item:RoomObstacle,x:number,z:number,useSnap=false):RoomObstacle=>{
    const rotation=((item.rotation%360)+360)%360,angle=rotation*Math.PI/180;
    const c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
    const limitX=Math.max(0,(w-c*item.width-s*item.depth)/2),limitZ=Math.max(0,(h-s*item.width-c*item.depth)/2);
    const grid=(value:number)=>Math.round(value/.05)*.05;
    return {...item,rotation,x:Math.max(-limitX,Math.min(limitX,useSnap?grid(x):x)),z:Math.max(-limitZ,Math.min(limitZ,useSnap?grid(z):z))};
  };
  const startOutline=(event:PointerEvent<SVGGElement>,item:RoomObstacle)=>{
    if(!onMoveObstacle||event.button!==0||drag.current||outlineDrag.current)return;
    event.preventDefault();event.stopPropagation();event.currentTarget.focus({preventScroll:true});
    event.currentTarget.setPointerCapture(event.pointerId);onSelectObstacle?.(item.id);
    const p=point(event);outlineDrag.current={pointerId:event.pointerId,item,offsetX:p.x-item.x,offsetZ:p.y-item.z,startX:event.clientX,startY:event.clientY,moved:false,next:item};
  };
  const move=(event:PointerEvent)=>{
    const outline=outlineDrag.current;
    if(outline){
      if(outline.pointerId!==event.pointerId)return;
      if(!outline.moved&&Math.hypot(event.clientX-outline.startX,event.clientY-outline.startY)<3)return;
      outline.moved=true;
      const p=point(event);outline.next=moveOutline(outline.item,p.x-outline.offsetX,p.y-outline.offsetZ,snap&&!event.shiftKey);
      setOutlineDraft(outline.next);return;
    }
    const current=drag.current;if(!current||current.pointerId!==event.pointerId)return;
    if(!current.moved&&Math.hypot(event.clientX-current.startX,event.clientY-current.startY)<3)return;
    current.moved=true;
    const p=point(event);current.next=movePlacement(current.item,layout,p.x-current.offsetX,p.y-current.offsetZ,snap&&!event.shiftKey);
    setDraft(current.next);
  };
  const finish=(event:PointerEvent,cancel=false)=>{
    const outline=outlineDrag.current;
    if(outline){
      if(outline.pointerId!==event.pointerId)return;
      outlineDrag.current=null;setOutlineDraft(null);
      if(!cancel&&outline.moved&&(outline.next.x!==outline.item.x||outline.next.z!==outline.item.z))onMoveObstacle?.(outline.next);
      return;
    }
    const current=drag.current;if(!current||current.pointerId!==event.pointerId)return;
    drag.current=null;setDraft(null);
    if(!cancel&&current.moved&&(current.next.x!==current.item.x||current.next.z!==current.item.z))onMove?.(current.next);
  };
  const keyMove=(event:KeyboardEvent,item:PlacedItem)=>{
    if(!onMove)return;
    if(event.key==='Escape'){event.preventDefault();drag.current=null;setDraft(null);onDeselect?.();return;}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect?.(item.id);return;}
    const step=event.shiftKey?.25:.05;
    const delta:Record<string,[number,number]>={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
    if(delta[event.key]){event.preventDefault();onSelect?.(item.id);onMove(movePlacement(item,layout,item.x+delta[event.key][0],item.z+delta[event.key][1]));}
    if(event.key.toLowerCase()==='r'){event.preventDefault();onSelect?.(item.id);onMove(clampPlacement({...item,rotation:item.rotation+(event.shiftKey?-15:15)},layout));}
  };
  const keyMoveOutline=(event:KeyboardEvent,item:RoomObstacle)=>{
    if(event.key==='Escape'){event.preventDefault();outlineDrag.current=null;setOutlineDraft(null);onDeselect?.();return;}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelectObstacle?.(item.id);return;}
    if(!onMoveObstacle)return;
    const step=event.shiftKey?.25:.05;
    const delta:Record<string,[number,number]>={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
    if(delta[event.key]){event.preventDefault();onSelectObstacle?.(item.id);onMoveObstacle(moveOutline(item,item.x+delta[event.key][0],item.z+delta[event.key][1]));}
    if(event.key.toLowerCase()==='r'){event.preventDefault();onSelectObstacle?.(item.id);onMoveObstacle(moveOutline({...item,rotation:item.rotation+(event.shiftKey?-15:15)},item.x,item.z));}
  };
  return <svg ref={svg} className={`floor-plan ${compact?'compact':''}`} viewBox={`${-w/2-padding} ${-h/2-padding} ${w+padding*2} ${h+padding*2}`} aria-label={compact?`${layout.name}, ${layout.items.length+(layout.survey?.obstacles.length??0)} pieces`:'Room floor plan. Select a piece; drag or use arrow keys to move it. Press R to rotate.'} onPointerMove={move} onPointerUp={event=>finish(event)} onPointerCancel={event=>finish(event,true)} onLostPointerCapture={event=>finish(event,true)} onPointerDown={event=>{if(event.target===event.currentTarget||event.target instanceof SVGRectElement)onDeselect?.();}}>
    <defs><pattern id={pattern} width=".5" height=".5" patternUnits="userSpaceOnUse"><path d="M .5 0 L 0 0 0 .5" fill="none" stroke="#e3e6e3" strokeWidth=".008"/><circle cx="0" cy="0" r=".014" fill="#c8ccc8"/></pattern><pattern id={`${pattern}-existing`} width=".13" height=".13" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width=".13" height=".13" fill="#e8eae8"/><path d="M 0 0 V .13" stroke="#c3c8c4" strokeWidth=".022"/></pattern></defs>
    <rect x={-w/2} y={-h/2} width={w} height={h} fill="#ffffff"/>
    <rect x={-w/2} y={-h/2} width={w} height={h} fill={`url(#${pattern})`} stroke={layout.survey?'#c8ccc8':'#4f5551'} strokeWidth=".045" strokeDasharray={layout.survey?'.08 .08':undefined}/>
    {layout.survey?.walls.flatMap(wall=>solidWallSegments(wall,layout.survey!.openings).map((segment,i)=><line key={`${wall.id}-${i}`} x1={segment.start.x} y1={segment.start.z} x2={segment.end.x} y2={segment.end.z} stroke="#2c312e" strokeWidth=".075" strokeLinecap="square"/>))}
    {layout.survey?.openings.map(o=><g key={o.id}><line x1={o.start.x} y1={o.start.z} x2={o.end.x} y2={o.end.z} stroke={o.kind==='window'?'#6f93a8':'#8aa596'} strokeWidth={o.kind==='window'?'.045':'.025'} strokeDasharray={o.kind==='window'?undefined:'.08 .04'}/><title>{o.kind==='window'?'Window':'Doorway — keep clear'}</title></g>)}
    {displayed.survey?.obstacles.map((o,index)=><g key={o.id} transform={`translate(${o.x} ${o.z}) rotate(${o.rotation})`} role={onSelectObstacle&&!compact?'button':undefined} tabIndex={onSelectObstacle&&!compact?0:undefined} aria-label={`Scanned piece ${index+1}, ${o.width.toFixed(2)} by ${o.depth.toFixed(2)} metres`} data-outline-id={o.id} data-x={o.x.toFixed(3)} data-z={o.z.toFixed(3)} onFocus={()=>onSelectObstacle?.(o.id)} onClick={e=>{e.stopPropagation();onSelectObstacle?.(o.id);}} onPointerDown={e=>startOutline(e,o)} onKeyDown={e=>keyMoveOutline(e,o)} aria-pressed={onSelectObstacle&&!compact?selectedObstacleId===o.id:undefined} className={`existing-footprint ${onSelectObstacle?'selectable':''} ${onMoveObstacle?'draggable':''} ${outlineDraft?.id===o.id?'dragging':''}`}>
      {!compact&&<rect className="piece-hit-area" x={-Math.max(.55,o.width)/2} y={-Math.max(.55,o.depth)/2} width={Math.max(.55,o.width)} height={Math.max(.55,o.depth)} fill="transparent"/>}
      <rect x={-o.width/2} y={-o.depth/2} width={o.width} height={o.depth} rx=".035" fill={`url(#${pattern}-existing)`} stroke={selectedObstacleId===o.id?'#22594a':'#9aa09b'} strokeWidth={selectedObstacleId===o.id?'.035':'.018'}/>
    </g>)}
    {!compact&&<><path d={`M ${-w/2} ${-h/2-.3} h ${w} m ${-w} -.07 v .14 m ${w} -.14 v .14`} fill="none" stroke="#9aa09b" strokeWidth=".012"/><text x="0" y={-h/2-.4} textAnchor="middle" fill="#676d68" fontSize=".14">{w.toFixed(1)} m</text><text x={w/2+.25} y="0" textAnchor="middle" fill="#676d68" fontSize=".14" transform={`rotate(90 ${w/2+.25} 0)`}>{h.toFixed(1)} m</text></>}
    {displayed.items.map((item,index)=>{const d=item.product.dimensions,active=item.id===selectedId,variant=getVariant(item.product,item.variantId);const channels=variant.color.slice(1).match(/.{2}/g)!.map(value=>parseInt(value,16));const itemWarnings=placementWarnings(item,displayed);const labelColor=channels[0]*.299+channels[1]*.587+channels[2]*.114>145?'#1a1d1b':'#ffffff';return <g key={item.id} role={compact?undefined:'button'} tabIndex={compact?undefined:0} aria-label={`${item.name} ${index+1}, ${variant.name}, ${Math.round(item.rotation)} degrees`} aria-pressed={compact?undefined:active} transform={`translate(${item.x} ${item.z}) rotate(${item.rotation})`} data-piece-id={item.id} data-x={item.x.toFixed(3)} data-z={item.z.toFixed(3)} className={`plan-piece ${onMove?'draggable':''} ${draft?.id===item.id?'dragging':''}`} onFocus={()=>onSelect?.(item.id)} onPointerDown={event=>start(event,item)} onClick={event=>{event.stopPropagation();onSelect?.(item.id);}} onKeyDown={event=>keyMove(event,item)}>
      {!compact&&<rect className="piece-hit-area" x={-Math.max(.55,d.width)/2} y={-Math.max(.55,d.depth)/2} width={Math.max(.55,d.width)} height={Math.max(.55,d.depth)} fill="transparent"/>}
      {(active||itemWarnings.length>0)&&<rect x={-d.width/2-.065} y={-d.depth/2-.065} width={d.width+.13} height={d.depth+.13} rx=".06" fill="none" stroke={itemWarnings.length?'#b42318':'#22594a'} strokeWidth=".025" strokeDasharray=".055 .035"/>}
      {item.product.footprint==='ellipse'?<>
        <ellipse className="piece-shape" rx={d.width/2} ry={d.depth/2} fill={variant.color} stroke={active?'#22594a':'#3b403d'} strokeWidth=".018"/>
        <ellipse rx={Math.max(.01,d.width/2-.035)} ry={Math.max(.01,d.depth/2-.035)} fill="none" stroke={labelColor} strokeOpacity=".25" strokeWidth=".008"/>
        <path d={`M ${-d.width/2+.035} 0 H ${d.width/2-.035} M 0 ${-d.depth/2+.035} V ${d.depth/2-.035}`} stroke={labelColor} strokeOpacity=".25" strokeWidth=".008"/>
      </>:<>
        <rect className="piece-shape" x={-d.width/2} y={-d.depth/2} width={d.width} height={d.depth} rx=".07" fill={variant.color} stroke={active?'#22594a':'#3b403d'} strokeWidth=".018"/>
        {item.product.category==='Seating'&&<><rect x={-d.width/2+.11} y={-d.depth/2+.19} width={Math.max(.05,d.width-.22)} height={Math.max(.05,d.depth-.27)} rx=".07" fill="#ffffff" fillOpacity=".16" stroke={labelColor} strokeOpacity=".2" strokeWidth=".012"/>
        <rect x={-d.width/2+.09} y={-d.depth/2+.02} width={Math.max(.05,d.width-.18)} height=".17" rx=".05" fill="#000000" fillOpacity=".12"/></>}
      </>}
      {!compact&&<text x="0" y=".1" textAnchor="middle" fontSize=".16" fill={labelColor} transform={`rotate(${-item.rotation})`}>{index+1}</text>}
    </g>;})}
    {!layout.items.length&&!layout.survey&&<><path d="M -.18 -.18 h .36 v .36 h -.36 z M -.45 0 h -.17 m 1.07 0 h .17 M 0 -.45 v -.17 M 0 .45 v .17" fill="none" stroke="#c8ccc8" strokeWidth=".018"/>{!compact&&<text x="0" y=".92" textAnchor="middle" fontSize=".14" fill="#676d68">Add a product to start arranging</text>}</>}
  </svg>;
}
