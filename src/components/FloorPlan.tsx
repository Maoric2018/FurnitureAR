import { useId, useRef } from 'react';
import type { PointerEvent, KeyboardEvent } from 'react';
import { clampPlacement } from '../lib/workspace';
import { getVariant } from '../lib/products';
import type { RoomLayout, PlacedItem } from '../lib/workspace';
import { placementWarnings, solidWallSegments } from '../lib/room-scan';

interface Props { layout:RoomLayout; selectedId?:string; onSelect?:(id:string)=>void; onMove?:(item:PlacedItem)=>void; onMoveStart?:()=>void; compact?:boolean; selectedObstacleId?:string; onSelectObstacle?:(id:string)=>void }
export default function FloorPlan({layout,selectedId,onSelect,onMove,onMoveStart,compact=false,selectedObstacleId,onSelectObstacle}:Props){
  const svg=useRef<SVGSVGElement>(null);
  const drag=useRef<{id:string;offsetX:number;offsetZ:number}|null>(null);
  const pattern=useId().replace(/:/g,'');
  const padding=.65, w=layout.width,h=layout.depth;
  const point=(event:PointerEvent)=>{
    const element=svg.current!,point=element.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
    return point.matrixTransform(element.getScreenCTM()!.inverse());
  };
  const start=(event:PointerEvent<SVGGElement>,item:PlacedItem)=>{
    if(!onMove)return;
    event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);onSelect?.(item.id);onMoveStart?.();
    const p=point(event);drag.current={id:item.id,offsetX:p.x-item.x,offsetZ:p.y-item.z};
  };
  const move=(event:PointerEvent)=>{
    if(!drag.current||!onMove)return;
    const item=layout.items.find(item=>item.id===drag.current!.id);if(!item)return;
    const p=point(event);onMove(clampPlacement({...item,x:p.x-drag.current.offsetX,z:p.y-drag.current.offsetZ},layout));
  };
  const keyMove=(event:KeyboardEvent,item:PlacedItem)=>{
    if(!onMove)return;
    const step=event.shiftKey?.25:.05;
    const delta:Record<string,[number,number]>={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
    if(delta[event.key]){event.preventDefault();onMoveStart?.();onMove(clampPlacement({...item,x:item.x+delta[event.key][0],z:item.z+delta[event.key][1]},layout));}
    if(event.key.toLowerCase()==='r'){event.preventDefault();onMoveStart?.();onMove(clampPlacement({...item,rotation:item.rotation+15},layout));}
  };
  return <svg ref={svg} className={`floor-plan ${compact?'compact':''}`} viewBox={`${-w/2-padding} ${-h/2-padding} ${w+padding*2} ${h+padding*2}`} aria-label={compact?`${layout.name}, ${layout.items.length} pieces`:'Room floor plan. Select a piece; drag or use arrow keys to move it. Press R to rotate.'} onPointerMove={move} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
    <defs><pattern id={pattern} width=".5" height=".5" patternUnits="userSpaceOnUse"><path d="M .5 0 L 0 0 0 .5" fill="none" stroke="#dedbd4" strokeWidth=".008"/><circle cx="0" cy="0" r=".014" fill="#c4c0b7"/></pattern><pattern id={`${pattern}-existing`} width=".13" height=".13" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width=".13" height=".13" fill="#e0e2dc"/><path d="M 0 0 V .13" stroke="#b8bdb1" strokeWidth=".022"/></pattern></defs>
    <rect x={-w/2} y={-h/2} width={w} height={h} fill="#f7f5ef"/>
    <rect x={-w/2} y={-h/2} width={w} height={h} fill={`url(#${pattern})`} stroke={layout.survey?'#d4d7cc':'#797b72'} strokeWidth=".045" strokeDasharray={layout.survey?'.08 .08':undefined}/>
    {layout.survey?.walls.flatMap(wall=>solidWallSegments(wall,layout.survey!.openings).map((segment,i)=><line key={`${wall.id}-${i}`} x1={segment.start.x} y1={segment.start.z} x2={segment.end.x} y2={segment.end.z} stroke="#50594b" strokeWidth=".075" strokeLinecap="square"/>))}
    {layout.survey?.openings.map(o=><g key={o.id}><line x1={o.start.x} y1={o.start.z} x2={o.end.x} y2={o.end.z} stroke={o.kind==='window'?'#77969b':'#93a183'} strokeWidth={o.kind==='window'?'.045':'.025'} strokeDasharray={o.kind==='window'?undefined:'.08 .04'}/><title>{o.kind==='window'?'Window':'Doorway — keep clear'}</title></g>)}
    {layout.survey?.obstacles.map(o=><g key={o.id} transform={`translate(${o.x} ${o.z}) rotate(${o.rotation})`} role={onSelectObstacle&&!compact?'button':undefined} tabIndex={onSelectObstacle&&!compact?0:undefined} aria-label={`Existing ${o.name}, ${o.width.toFixed(2)} by ${o.depth.toFixed(2)} metres`} onClick={()=>onSelectObstacle?.(o.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelectObstacle?.(o.id);}}} className={onSelectObstacle?'existing-footprint selectable':'existing-footprint'}>
      <rect x={-o.width/2} y={-o.depth/2} width={o.width} height={o.depth} rx=".035" fill={`url(#${pattern}-existing)`} stroke={selectedObstacleId===o.id?'#a6613b':'#8c9583'} strokeWidth={selectedObstacleId===o.id?'.035':'.018'}/>
      {!compact&&<text x="0" y=".04" textAnchor="middle" fontSize=".115" fill="#525d4a" transform={`rotate(${-o.rotation})`} paintOrder="stroke" stroke="#e0e2dc" strokeWidth=".025">{o.name.length>18?`${o.name.slice(0,17)}…`:o.name}</text>}
    </g>)}
    {!compact&&<><path d={`M ${-w/2} ${-h/2-.3} h ${w} m ${-w} -.07 v .14 m ${w} -.14 v .14`} fill="none" stroke="#a4a59d" strokeWidth=".012"/><text x="0" y={-h/2-.4} textAnchor="middle" fill="#85877e" fontSize=".14">{w.toFixed(1)} m</text><text x={w/2+.25} y="0" textAnchor="middle" fill="#85877e" fontSize=".14" transform={`rotate(90 ${w/2+.25} 0)`}>{h.toFixed(1)} m</text></>}
    {layout.items.map((item,index)=>{const d=item.product.dimensions,active=item.id===selectedId,variant=getVariant(item.product,item.variantId);const channels=variant.color.slice(1).match(/.{2}/g)!.map(value=>parseInt(value,16));const labelColor=channels[0]*.299+channels[1]*.587+channels[2]*.114>145?'#30291f':'#fffdf8';return <g key={item.id} role={compact?undefined:'button'} tabIndex={compact?undefined:0} aria-label={`${item.name} ${index+1}, ${variant.name}, ${Math.round(item.rotation)} degrees`} aria-pressed={compact?undefined:active} transform={`translate(${item.x} ${item.z}) rotate(${item.rotation})`} className={onMove?'plan-piece draggable':'plan-piece'} onPointerDown={event=>start(event,item)} onClick={()=>onSelect?.(item.id)} onKeyDown={event=>keyMove(event,item)}>
      {(active||placementWarnings(item,layout).length>0)&&<rect x={-d.width/2-.065} y={-d.depth/2-.065} width={d.width+.13} height={d.depth+.13} rx=".06" fill="none" stroke={placementWarnings(item,layout).length?'#c34936':'#bb5839'} strokeWidth=".025" strokeDasharray=".055 .035"/>}
      {item.product.footprint==='ellipse'?<>
        <ellipse rx={d.width/2} ry={d.depth/2} fill={variant.color} stroke={active?'#a85537':'#554d40'} strokeWidth=".018"/>
        <ellipse rx={Math.max(.01,d.width/2-.035)} ry={Math.max(.01,d.depth/2-.035)} fill="none" stroke={labelColor} strokeOpacity=".25" strokeWidth=".008"/>
        <path d={`M ${-d.width/2+.035} 0 H ${d.width/2-.035} M 0 ${-d.depth/2+.035} V ${d.depth/2-.035}`} stroke={labelColor} strokeOpacity=".25" strokeWidth=".008"/>
      </>:<>
        <rect x={-d.width/2} y={-d.depth/2} width={d.width} height={d.depth} rx=".07" fill={variant.color} stroke={active?'#a85537':'#554d40'} strokeWidth=".018"/>
        {item.product.category==='Seating'&&<><rect x={-d.width/2+.11} y={-d.depth/2+.19} width={Math.max(.05,d.width-.22)} height={Math.max(.05,d.depth-.27)} rx=".07" fill="#ffffff" fillOpacity=".16" stroke={labelColor} strokeOpacity=".2" strokeWidth=".012"/>
        <rect x={-d.width/2+.09} y={-d.depth/2+.02} width={Math.max(.05,d.width-.18)} height=".17" rx=".05" fill="#000000" fillOpacity=".12"/></>}
      </>}
      {!compact&&<text x="0" y=".1" textAnchor="middle" fontSize=".16" fill={labelColor} transform={`rotate(${-item.rotation})`}>{index+1}</text>}
    </g>;})}
    {!layout.items.length&&!layout.survey&&<><path d="M -.18 -.18 h .36 v .36 h -.36 z M -.45 0 h -.17 m 1.07 0 h .17 M 0 -.45 v -.17 M 0 .45 v .17" fill="none" stroke="#b5b2a8" strokeWidth=".018"/>{!compact&&<text x="0" y=".92" textAnchor="middle" fontSize=".14" fill="#9a988e">Add a product to start arranging</text>}</>}
  </svg>;
}
