import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, RotateCcw, ScanLine } from 'lucide-react';
import type { RoomLayout } from '../lib/workspace';
import { exportLayout, exportNativeLayout } from '../lib/layout-model';
import { bytesToBase64, hasNativeRoomAR, nativeLayoutMetadata, nativeRequest } from '../lib/native-room';
import { Viewer } from './Viewer';
import type { ViewerHandle } from './Viewer';
export default function LayoutViewer({layout,onUnavailable}:{layout:RoomLayout;onUnavailable:()=>void}){
  const [model,setModel]=useState<Awaited<ReturnType<typeof exportLayout>>|null>(null),[error,setError]=useState(''),[ready,setReady]=useState(false),[status,setStatus]=useState(''),[retry,setRetry]=useState(0);
  const viewer=useRef<ViewerHandle>(null);
  const [nativeBusy,setNativeBusy]=useState(false);
  const native=hasNativeRoomAR()&&!!layout.survey;
  const nativeExport=useRef<AbortController|null>(null);
  useEffect(()=>{setNativeBusy(false);return()=>nativeExport.current?.abort();},[layout]);
  const startAR=async()=>{
    if(!native){viewer.current?.startAR();return;}
    const controller=new AbortController();nativeExport.current=controller;setNativeBusy(true);setStatus('Preparing your room-aligned preview…');
    try{const metadata=nativeLayoutMetadata(layout),bytes=await exportNativeLayout(layout,controller.signal);
      await nativeRequest('preview',{...metadata,model:bytesToBase64(bytes)});if(!controller.signal.aborted)setStatus('Preview opened in the app.');
    }catch(error){if(!controller.signal.aborted)setStatus(error instanceof Error?error.message:'The app preview could not open.');}
    finally{if(!controller.signal.aborted)setNativeBusy(false);}
  };
  const onReady=useCallback((value:boolean)=>setReady(value),[]),onStatus=useCallback((value:string)=>setStatus(value),[]);
  useEffect(()=>{
    const controller=new AbortController();let active=true,url:string|undefined;
    setModel(null);setError('');setReady(false);setStatus('');
    exportLayout(layout,controller.signal).then(value=>{
      if(!active){URL.revokeObjectURL(value.url);return;}url=value.url;setModel(value);
    }).catch(error=>{if(active)setError((error as Error).message);});
    return ()=>{active=false;controller.abort();if(url)URL.revokeObjectURL(url);};
  },[layout,retry]);
  return <div className="layout-3d">
    {model?<Viewer ref={viewer} src={model.url} name={layout.name} interactive ar expectedDimensions={model.dimensions} onReady={onReady} onStatus={onStatus} onUnavailable={onUnavailable}/>:<div className="layout-loading">{error?<><p>{error}</p><button className="text-button" onClick={()=>setRetry(value=>value+1)}><RotateCcw size={16}/> Try again</button></>:<><span className="loading-ring"/><p>Building your arrangement…</p></>}</div>}
    <div className="layout-ar-bar"><div><strong>Your pieces, together.</strong><p>{native?'Your app matches this layout to the scanned room. If it cannot recognize the room, it will guide you through alignment.':layout.survey?'Browser AR needs manual placement. Open this layout in the iPhone app for room alignment.':'Spacing and scale carry into AR. Move the whole arrangement as one.'}</p></div><button className="button primary" disabled={!ready||nativeBusy} onClick={()=>void startAR()}><ScanLine size={18}/>{nativeBusy?'Preparing preview…':'View layout in your room'}<ArrowUpRight size={16}/></button></div>{status&&<p className="layout-ar-status" role="status">{status}</p>}
  </div>;
}
