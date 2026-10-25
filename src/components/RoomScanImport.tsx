import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, FileUp, ScanLine, Smartphone } from 'lucide-react';
import Modal from './Modal';
import FloorPlan from './FloorPlan';
import { MAX_SCAN_BYTES, readRoomScanText } from '../lib/room-scan';
import type { ImportedRoom } from '../lib/room-scan';

export default function RoomScanImport({onClose,onImport,initial,initialError,replace=false}:{
  onClose:()=>void;onImport:(room:ImportedRoom)=>void;initial?:ImportedRoom;initialError?:string;replace?:boolean;
}){
  const [scan,setScan]=useState(initial),[error,setError]=useState(initialError??''),[busy,setBusy]=useState(false);
  const [mode,setMode]=useState<'choose'|'upload'|'scan'>(initial||initialError?'upload':'choose');
  const request=useRef(0);
  // A native handoff can arrive while the scan options are already open.
  useEffect(()=>{
    if(!initial&&!initialError)return;
    request.current++;setScan(initial);setError(initialError??'');setBusy(false);setMode('upload');
  },[initial,initialError]);
  const chooseMode=(next:'choose'|'upload'|'scan')=>{
    request.current++;setScan(undefined);setError('');setBusy(false);setMode(next);
  };
  const load=async(file?:File)=>{
    if(!file)return;
    const token=++request.current;setBusy(true);setError('');setScan(undefined);
    try{if(file.size>MAX_SCAN_BYTES)throw new Error('Choose the room JSON file, not a 3D model or video.');
      const parsed=readRoomScanText(await file.text());if(token===request.current)setScan(parsed);
    }catch(e){if(token===request.current)setError((e as Error).message);}
    finally{if(token===request.current)setBusy(false);}
  };
  return <Modal label="Room scan" className="scan-modal" onClose={onClose}><div className="modal-form scan-import">
    {!scan&&mode!=='choose'&&<button className="text-button scan-back" onClick={()=>chooseMode('choose')}><ArrowLeft size={14}/>Back to scan options</button>}
    <h2>{scan?'Review room scan':mode==='choose'?'Room scan':mode==='upload'?'Upload a room scan':'Scan your room'}</h2>
    <p>{scan?'Check the outline and existing furniture before using this scan.':mode==='choose'?'Upload a saved room scan or scan your room with the Furniture AR Scan app.':mode==='upload'?'Choose the room file exported by Furniture AR Scan. You can review it before creating a layout.':'Use the existing LiDAR scanner on your iPhone or iPad, then bring the room file back here.'}</p>
    {!scan&&mode==='choose'&&<><div className="scan-options">
      <button className="scan-option" onClick={()=>chooseMode('upload')}><FileUp size={22}/><span><strong>Upload a room scan</strong><small>Choose a saved Furniture AR room file (.json).</small></span><ArrowRight size={17}/></button>
      <a className="scan-option" href="furniturear-scan://scan" onClick={()=>chooseMode('scan')}><ScanLine size={22}/><span><strong>Perform a room scan</strong><small>Open Furniture AR Scan on a LiDAR iPhone or iPad.</small></span><ExternalLink size={17}/></a>
    </div><p className="scan-setup-note">Scanning requires the installed Furniture AR Scan app. <a className="text-button" href="/room-scanner.html" target="_blank" rel="noreferrer">Scanner setup instructions<ExternalLink size={14}/></a></p></>}
    {!scan&&mode==='scan'&&<><div className="scan-instructions"><Smartphone size={20}/><div><strong>In Furniture AR Scan</strong><ol><li>Slowly scan every wall, then tap Finish scan.</li><li>Choose Save / share room file, then Save to Files.</li><li>Return here and upload the saved room file to review it.</li></ol><p className="scan-return-note">The installed app’s Open in Furniture AR button opens the earlier Eric site. Use the saved room file to continue on this site.</p><a className="text-button" href="/room-scanner.html" target="_blank" rel="noreferrer">Scanner setup instructions<ExternalLink size={14}/></a></div></div><a className="button primary" href="furniturear-scan://scan">Open Furniture AR Scan<ExternalLink size={16}/></a><button className="button secondary" onClick={()=>chooseMode('upload')}><FileUp size={16}/>Upload the completed scan</button></>}
    {(scan||mode==='upload')&&<label className="scan-file-input"><FileUp size={20}/><span>{busy?'Reading scan…':scan?'Choose a different scan':'Choose room scan'}<small>Furniture AR room file · .json</small></span><input aria-label="Choose room scan file" type="file" accept=".json,application/json" disabled={busy} onChange={e=>void load(e.target.files?.[0])}/></label>}
    {error&&<p className="scan-error" role="alert">{error}</p>}
    {scan&&<><div className="scan-review-plan"><FloorPlan layout={{id:'scan-review',name:scan.name,roomType:'Scanned room',width:scan.width,depth:scan.depth,survey:scan.survey,items:[],updatedAt:scan.survey.capturedAt}}/></div><div className="scan-stats"><span><strong>{scan.width.toFixed(2)} × {scan.depth.toFixed(2)} m</strong>Overall bounds</span><span><strong>{scan.survey.obstacles.length}</strong>Existing objects</span><span><strong>{scan.survey.walls.length}</strong>Wall sections</span></div><label className="field-label">Room name<input value={scan.name} maxLength={80} onChange={e=>setScan({...scan,name:e.target.value})}/></label><p className="scan-review-note">Scans are estimates. You can rename, resize, remove, or add existing objects in the layout. Check missed walls and important dimensions in your room.{replace?' This replaces the previous scan and keeps your new products within the updated bounds.':''}</p><button className="button primary" disabled={!scan.name.trim()||busy} onClick={()=>onImport({...scan,name:scan.name.trim()})}>{replace?'Use this scan':'Create layout from scan'}</button></>}
    <p className="scan-privacy">Your room file stays in this browser. Camera images aren’t uploaded.</p>
  </div></Modal>;
}
