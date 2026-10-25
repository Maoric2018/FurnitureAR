import { useRef, useState } from 'react';
import { ExternalLink, FileUp, Smartphone } from 'lucide-react';
import Modal from './Modal';
import FloorPlan from './FloorPlan';
import { MAX_SCAN_BYTES, readRoomScanText } from '../lib/room-scan';
import type { ImportedRoom } from '../lib/room-scan';

export default function RoomScanImport({onClose,onImport,initial,initialError,replace=false}:{
  onClose:()=>void;onImport:(room:ImportedRoom)=>void;initial?:ImportedRoom;initialError?:string;replace?:boolean;
}){
  const [scan,setScan]=useState(initial),[error,setError]=useState(initialError??''),[busy,setBusy]=useState(false);
  const request=useRef(0);
  const load=async(file?:File)=>{
    if(!file)return;
    const token=++request.current;setBusy(true);setError('');setScan(undefined);
    try{if(file.size>MAX_SCAN_BYTES)throw new Error('Choose the room JSON file, not a 3D model or video.');
      const parsed=readRoomScanText(await file.text());if(token===request.current)setScan(parsed);
    }catch(e){if(token===request.current)setError((e as Error).message);}
    finally{if(token===request.current)setBusy(false);}
  };
  return <Modal label="Import room scan" className="scan-modal" onClose={onClose}><div className="modal-form scan-import">
    <h2>{scan?'Review room scan':'Import a room scan'}</h2>
    <p>{scan?'Check the outline and existing furniture before using this scan.':'Scan with Furniture AR Scan on a LiDAR iPhone, then open the exported room file here.'}</p>
    {!scan&&<div className="scan-instructions"><Smartphone size={18}/><div><strong>On a LiDAR iPhone</strong><ol><li>Open Furniture AR Scan and slowly scan every wall.</li><li>Tap Finish scan, then Open in Furniture AR.</li><li>Or save the room file to Files and choose it below.</li></ol><a className="text-button" href="/room-scanner.html" target="_blank" rel="noreferrer">Scanner setup instructions<ExternalLink size={14}/></a></div></div>}
    <label className="scan-file-input"><FileUp size={20}/><span>{busy?'Reading scan…':scan?'Choose a different scan':'Choose room scan'}<small>Furniture AR room file · .json</small></span><input aria-label="Choose room scan file" type="file" accept=".json,application/json" disabled={busy} onChange={e=>void load(e.target.files?.[0])}/></label>
    {error&&<p className="scan-error" role="alert">{error}</p>}
    {scan&&<><div className="scan-review-plan"><FloorPlan layout={{id:'scan-review',name:scan.name,roomType:'Scanned room',width:scan.width,depth:scan.depth,survey:scan.survey,items:[],updatedAt:scan.survey.capturedAt}}/></div><div className="scan-stats"><span><strong>{scan.width.toFixed(2)} × {scan.depth.toFixed(2)} m</strong>Overall bounds</span><span><strong>{scan.survey.obstacles.length}</strong>Existing objects</span><span><strong>{scan.survey.walls.length}</strong>Wall sections</span></div><label className="field-label">Room name<input value={scan.name} maxLength={80} onChange={e=>setScan({...scan,name:e.target.value})}/></label><p className="scan-review-note">Scans are estimates. You can rename, resize, remove, or add existing objects in the layout. Check missed walls and important dimensions in your room.{replace?' This replaces the previous scan and keeps your new products within the updated bounds.':''}</p><button className="button primary" disabled={!scan.name.trim()||busy} onClick={()=>onImport({...scan,name:scan.name.trim()})}>{replace?'Use this scan':'Create layout from scan'}</button></>}
    <p className="scan-privacy">Your room file stays in this browser. Camera images aren’t uploaded.</p>
  </div></Modal>;
}
