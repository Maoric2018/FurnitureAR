import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, FileUp, ScanLine, Smartphone } from 'lucide-react';
import Modal from './Modal';
import FloorPlan from './FloorPlan';
import { MAX_SCAN_BYTES, readRoomScanText } from '../lib/room-scan';
import type { ImportedRoom } from '../lib/room-scan';

export default function RoomScanImport({onClose,onImport,onBack,initial,initialError,replace=false}:{
  onClose:()=>void;onImport:(room:ImportedRoom)=>void;onBack?:()=>void;initial?:ImportedRoom;initialError?:string;replace?:boolean;
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
  return <Modal label={scan?'Review room scan':'Scan your room'} className="scan-modal" onClose={onClose}><div className="modal-form scan-import">
    {onBack&&<button className="text-button setup-back" onClick={onBack}><ArrowLeft size={15}/>Back</button>}
    <span className="modal-symbol"><ScanLine size={25}/></span><span className="overline">START WITH WHAT’S THERE</span>
    <h2>{scan?'Meet your room.':'Scan your room.'}</h2>
    <p>{scan?'Check the outline and existing furniture, then create your floor plan.':'Capture your walls and existing furniture with the Furniture AR Scan app.'}</p>
    {!scan&&<><div className="scan-instructions"><Smartphone size={26}/><div><strong>LiDAR iPhone or iPad</strong><ol><li>Open the scanner and slowly scan every wall.</li><li>Tap Finish scan.</li><li>{replace?'Save the room file to Files, then choose it below.':'Tap Open in Furniture AR to return to your floor plan.'}</li></ol><a href="/room-scanner.html" target="_blank" rel="noreferrer">Install the scanner <ArrowRight size={12}/></a></div></div>{!replace&&<a className="button primary open-room-scanner" href="furniturear-scan://scan"><ScanLine size={18}/>Open room scanner<ArrowRight size={16}/></a>}<p className="scan-file-alternative">{replace?'Import your replacement scan.':'Already have a scan? Choose its room file below.'}</p></>}
    <label className="scan-file-input"><FileUp size={18}/><span>{busy?'Reading scan…':scan?'Choose a different scan':'Choose room scan'}<small>Furniture AR room file · .json</small></span><input aria-label="Choose room scan file" type="file" accept=".json,application/json" disabled={busy} onChange={e=>void load(e.target.files?.[0])}/></label>
    {error&&<p className="scan-error" role="alert">{error}</p>}
    {scan&&<><div className="scan-review-plan"><FloorPlan layout={{id:'scan-review',name:scan.name,roomType:'Scanned room',width:scan.width,depth:scan.depth,survey:scan.survey,items:[],updatedAt:scan.survey.capturedAt}}/></div><div className="scan-stats"><span><strong>{scan.width.toFixed(2)} × {scan.depth.toFixed(2)} m</strong>Overall bounds</span><span><strong>{scan.survey.obstacles.length}</strong>Existing objects</span><span><strong>{scan.survey.walls.length}</strong>Wall sections</span></div><label className="field-label">Room name<input value={scan.name} maxLength={80} onChange={e=>setScan({...scan,name:e.target.value})}/></label><p className="scan-review-note">Scans are estimates. You can resize, remove, or add existing objects in the layout. Check missed walls and important dimensions in your room.{replace?' This replaces the previous scan and keeps your new products within the updated bounds.':''}</p><button className="button primary" disabled={!scan.name.trim()||busy} onClick={()=>onImport({...scan,name:scan.name.trim()})}>{replace?'Use this scan':'Create layout from scan'}<ArrowRight size={16}/></button></>}
    <p className="scan-privacy">Your room is saved on this device. Using Design my room sends its floor plan and any photos you choose to Claude.</p>
  </div></Modal>;
}
