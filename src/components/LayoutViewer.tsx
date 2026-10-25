import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, ScanLine } from 'lucide-react';
import type { RoomLayout } from '../lib/workspace';
import { exportLayout } from '../lib/layout-model';
import { Viewer } from './Viewer';
import type { ViewerHandle } from './Viewer';
export default function LayoutViewer({layout,onUnavailable}:{layout:RoomLayout;onUnavailable:()=>void}){
  const [model,setModel]=useState<Awaited<ReturnType<typeof exportLayout>>|null>(null),[error,setError]=useState(''),[ready,setReady]=useState(false),[status,setStatus]=useState(''),[retry,setRetry]=useState(0);
  const viewer=useRef<ViewerHandle>(null);
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
    {model?<Viewer ref={viewer} src={model.url} name={layout.name} interactive ar expectedDimensions={model.dimensions} onReady={onReady} onStatus={onStatus} onUnavailable={onUnavailable}/>:<div className="layout-loading">{error?<><p>{error}</p><button className="text-button" onClick={()=>setRetry(value=>value+1)}><RotateCcw size={16}/> Try again</button></>:<><span className="loading-ring"/><p>Loading layout…</p></>}</div>}
    <div className="layout-ar-bar"><div><p>{layout.survey?'AR shows new products only. Position them manually in your room.':'Actual scale · Move the arrangement as one.'}</p></div><button className="button primary" disabled={!ready} onClick={()=>viewer.current?.startAR()}><ScanLine size={16}/>View in AR</button></div>{status&&<p className="layout-ar-status status-text" role="status">{status}</p>}
  </div>;
}
