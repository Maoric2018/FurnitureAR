import { useEffect, useState } from 'react';
import { LockKeyhole, Plus, Trash2 } from 'lucide-react';
import type { RoomObstacle, RoomSurvey } from '../lib/room-scan';
import { parseObstacle } from '../lib/room-scan';

function ObstacleForm({obstacle,onSave,onRemove}:{obstacle:RoomObstacle;onSave:(o:RoomObstacle)=>void;onRemove:()=>void}){
  const [draft,setDraft]=useState<Record<string,string>>({}),[error,setError]=useState('');
  useEffect(()=>{setDraft(Object.fromEntries(Object.entries(obstacle).map(([key,value])=>[key,typeof value==='number'?String(Number(value.toFixed(3))):String(value)])));setError('');},[obstacle]);
  return <form className="obstacle-properties" onSubmit={e=>{e.preventDefault();try{
    onSave(parseObstacle({...obstacle,name:draft.name,...Object.fromEntries(['x','z','width','depth','height','rotation'].map(key=>[key,Number(draft[key])]))}));setError('');
  }catch{setError('Enter a name, positive sizes, and a rotation from −360° to 360°.');}}}>
    <label className="field-label">Name<input required maxLength={60} value={draft.name??''} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
    <div className="obstacle-fields">{[{key:'width',label:'Width (m)',min:.02,max:20},{key:'depth',label:'Depth (m)',min:.02,max:20},{key:'x',label:'X position (m)',min:-100,max:100},{key:'z',label:'Y position (m)',min:-100,max:100},{key:'height',label:'Height (m)',min:.02,max:12},{key:'rotation',label:'Rotation (°)',min:-360,max:360}].map(field=><label className="field-label" key={field.key}>{field.label}<input required type="number" step="any" min={field.min} max={field.max} value={draft[field.key]??''} onChange={e=>setDraft({...draft,[field.key]:e.target.value})}/></label>)}</div>
    <small>Positions are relative to the room centre.</small>
    {error&&<p className="scan-error" role="alert">{error}</p>}
    <div className="piece-actions"><button type="submit">Save changes</button><button className="icon-button" type="button" aria-label="Remove existing object" title="Remove existing object" onClick={onRemove}><Trash2 size={16}/></button></div>
  </form>;
}
export default function ExistingObjects({survey,selectedId,onSelect,onChange}:{survey:RoomSurvey;selectedId?:string;onSelect:(id:string)=>void;onChange:(survey:RoomSurvey)=>void}){
  const selected=survey.obstacles.find(o=>o.id===selectedId);
  return <section className="existing-objects"><div className="existing-heading"><div><LockKeyhole size={14}/><h3>Existing furniture <span>{survey.obstacles.length}</span></h3></div><button className="icon-button" aria-label="Add existing object" title="Add existing object" disabled={survey.obstacles.length>=200} onClick={()=>{const o:RoomObstacle={id:crypto.randomUUID(),name:'Existing furniture',category:'other',x:0,z:0,width:1,depth:.6,height:.8,rotation:0,confidence:'unknown'};onChange({...survey,obstacles:[...survey.obstacles,o]});onSelect(o.id);}}><Plus size={16}/></button></div><p className="existing-description">Select furniture to edit the scan.</p>
    <div className="existing-list">{survey.obstacles.map(o=><button key={o.id} className={selectedId===o.id?'selected':''} aria-pressed={selectedId===o.id} onClick={()=>onSelect(o.id)}><span className="existing-swatch"/><span><strong>{o.name}</strong><small>{o.width.toFixed(2)} × {o.depth.toFixed(2)} m{o.confidence==='low'&&<> · <span className="low-confidence">Check detection</span></>}</small></span></button>)}{!survey.obstacles.length&&<p>No furniture detected. Add missing objects.</p>}</div>
    {selected&&<ObstacleForm obstacle={selected} onSave={o=>onChange({...survey,obstacles:survey.obstacles.map(value=>value.id===o.id?o:value)})} onRemove={()=>onChange({...survey,obstacles:survey.obstacles.filter(o=>o.id!==selected.id)})}/>}
  </section>;
}
