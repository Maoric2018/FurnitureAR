import { useEffect, useState } from 'react';
import { Copy, RotateCw, Trash2 } from 'lucide-react';
import type { RoomObstacle } from '../lib/room-scan';
import { parseObstacle } from '../lib/room-scan';

type Measurement = 'x'|'z'|'width'|'depth'|'height'|'rotation';
const displayMeasurement=(value:number)=>String(Number(value.toFixed(3)));

/** Scanned outlines use the same layout inspector and autosave as product pieces. */
export default function ExistingObjects({obstacle,index,onChange,onRemove,onDuplicate}:{
  obstacle:RoomObstacle;index:number;onChange:(o:RoomObstacle)=>void;onRemove:()=>void;onDuplicate?:()=>void;
}){
  const [draft,setDraft]=useState<Record<string,string>>({}),[error,setError]=useState('');
  useEffect(()=>{
    setDraft(Object.fromEntries(Object.entries(obstacle).map(([key,value])=>[key,typeof value==='number'?displayMeasurement(value):String(value)])));
    setError('');
  },[obstacle]);
  const save=(key:Measurement,input:HTMLInputElement)=>{
    try{
      if(!input.validity.valid||!input.value.trim())throw new Error(input.validationMessage||'Enter a measurement.');
      // The displayed rounding is presentation only. Blurring an untouched field
      // must not modify scan coordinates or round unrelated measurements.
      if(input.value!==displayMeasurement(obstacle[key])){
        const next=parseObstacle({...obstacle,[key]:Number(input.value)});
        if(next[key]!==obstacle[key])onChange(next);
      }
      setError('');
    }catch(e){setError((e as Error).message||'Enter positive sizes and a rotation from −360° to 360°.');}
  };
  return <form className="item-properties outline-properties" onSubmit={e=>e.preventDefault()}>
    <div className="property-heading"><h3>Scanned piece {index}</h3><span className="tag">Outline</span></div>
    <div className="obstacle-fields">{([{key:'width',label:'Width (m)',min:.02,max:20},{key:'depth',label:'Depth (m)',min:.02,max:20},{key:'x',label:'X position (m)',min:-100,max:100},{key:'z',label:'Y position (m)',min:-100,max:100},{key:'height',label:'Height (m)',min:.02,max:12},{key:'rotation',label:'Rotation (°)',min:-360,max:360}] as const).map(field=><label className="field-label" key={field.key}>{field.label}<input required type="number" step="any" min={field.min} max={field.max} value={draft[field.key]??''} onChange={e=>setDraft({...draft,[field.key]:e.target.value})} onBlur={e=>save(field.key,e.currentTarget)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}}}/></label>)}</div>
    <div className="rotation-control"><span>Rotate outline</span><button type="button" className="icon-button" aria-label="Rotate scanned piece 15 degrees" title="Rotate 15°" onClick={()=>onChange({...obstacle,rotation:((obstacle.rotation+15)%360+360)%360})}><RotateCw size={16}/></button></div>
    <p className="position-hint">Positions use the room centre. Drag or use arrow keys to move; R rotates. Measurements save after editing.</p>
    {error&&<p className="scan-error" role="alert">{error}</p>}
    <div className="piece-actions"><button className="icon-button" type="button" aria-label="Duplicate scanned piece" title="Duplicate scanned piece" disabled={!onDuplicate} onClick={onDuplicate}><Copy size={16}/></button><button className="icon-button" type="button" aria-label="Remove scanned piece" title="Remove scanned piece" onClick={onRemove}><Trash2 size={16}/></button></div>
  </form>;
}
