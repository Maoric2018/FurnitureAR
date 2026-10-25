import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, FileUp, ScanLine, Smartphone } from 'lucide-react';
import Modal from './Modal';
import { MAX_SCAN_BYTES, readRoomScanText } from '../lib/room-scan';
import type { ImportedRoom } from '../lib/room-scan';
import { hasNativeRoomAR, nativeRequest } from '../lib/native-room';

export default function RoomScanImport({onClose,onImport,initialError,onBack}:{
  onClose:()=>void;onImport:(room:ImportedRoom)=>void;initialError?:string;onBack?:()=>void;
}){
  const [error,setError]=useState(initialError??''),[busy,setBusy]=useState(false);
  const [mode,setMode]=useState<'choose'|'upload'|'scan'>(initialError?'upload':'choose');
  const request=useRef(0),native=hasNativeRoomAR();
  useEffect(()=>()=>{request.current++;},[]);
  useEffect(()=>{if(initialError){request.current++;setError(initialError);setBusy(false);setMode('upload');}},[initialError]);
  const chooseMode=(next:'choose'|'upload'|'scan')=>{request.current++;setError('');setBusy(false);setMode(next);};
  const load=async(file?:File)=>{
    if(!file)return;
    const token=++request.current;setBusy(true);setError('');
    try{
      if(file.size>MAX_SCAN_BYTES)throw new Error('Choose the room JSON file, not a 3D model or video.');
      const parsed=readRoomScanText(await file.text());
      if(token===request.current)onImport(parsed);
    }catch(e){if(token===request.current)setError((e as Error).message);}
    finally{if(token===request.current)setBusy(false);}
  };
  const scan=()=>{chooseMode('scan');if(native)void nativeRequest('scan').catch(e=>setError((e as Error).message));};
  const scanLink=(className:string,content:ReactNode)=>native
    ?<button className={className} onClick={scan}>{content}</button>
    :<a className={className} href="furniturear-scan://scan" onClick={scan}>{content}</a>;
  return <Modal label="Room scan" className="scan-modal" onClose={onClose}><div className="modal-form scan-import">
    {(mode!=='choose'||onBack)&&<button className="icon-button scan-back" aria-label={mode==='choose'?'Back to new layout':'Back to scan options'} title={mode==='choose'?'Back to new layout':'Back to scan options'} onClick={()=>mode==='choose'?onBack?.():chooseMode('choose')}><ArrowLeft size={18}/></button>}
    <h2>{mode==='choose'?'Start a layout from a scan':mode==='upload'?'Upload a room scan':'Scan your room'}</h2>
    <p>Your scan opens as a new layout with the main walls aligned to the grid.</p>
    {mode==='choose'&&<><div className="scan-options">
      <button className="scan-option" onClick={()=>chooseMode('upload')}><FileUp size={22}/><span><strong>Upload a room scan</strong><small>Saved room file · .json</small></span><ArrowRight size={17}/></button>
      {scanLink('scan-option',<><ScanLine size={22}/><span><strong>Perform a room scan</strong><small>LiDAR iPhone or iPad · scanner app required</small></span><ExternalLink size={17}/></>)}
    </div><p className="scan-setup-note"><a className="text-button" href="/room-scanner.html" target="_blank" rel="noreferrer">Set up the scanner<ExternalLink size={14}/></a></p></>}
    {mode==='scan'&&<><div className="scan-instructions"><Smartphone size={20}/><div><strong>In Roomify Scan</strong><ol><li>Slowly scan every wall, then tap Finish scan.</li><li>Open the completed scan in the planner to create your layout.</li><li>To use this browser, save the room JSON to Files and upload it here.</li></ol><p className="scan-return-note">If an older scanner opens a different website, use its saved room file to continue here.</p><a className="text-button" href="/room-scanner.html" target="_blank" rel="noreferrer">Set up the scanner<ExternalLink size={14}/></a></div></div>{scanLink('button primary',<>Open Roomify Scan<ExternalLink size={16}/></>)}<button className="button secondary" onClick={()=>chooseMode('upload')}><FileUp size={16}/>Upload the completed scan</button></>}
    {mode==='upload'&&<label className="scan-file-input"><FileUp size={20}/><span>{busy?'Opening your layout…':'Choose room scan'}<small>Roomify room file · .json</small></span><input aria-label="Choose room scan file" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}}/></label>}
    {error&&<p className="scan-error" role="alert">{error}</p>}
    <p className="scan-privacy">Your room is saved on this device. Using Design my room sends its floor plan and any photos you choose to Claude.</p>
  </div></Modal>;
}
