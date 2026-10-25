import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, ExternalLink, LoaderCircle, Sparkles } from 'lucide-react';
import type { DesignProposal } from '../lib/design';
import type { RoomLayout } from '../lib/workspace';
import { createUrbanDemoRoom, runUrbanDemo, URBAN_DEMO_OPTIONS, URBAN_DEMO_PRODUCTS, URBAN_DEMO_STAGES } from '../lib/urban-demo';
import Modal from './Modal';
import FloorPlan from './FloorPlan';
import './room-designer.css';
import './urban-demo.css';

export default function DemoRoomDesigner({onClose,onApply}:{layout:RoomLayout;onClose:()=>void;onApply:(proposal:DesignProposal)=>void}){
  const [brief,setBrief]=useState(''),[busy,setBusy]=useState(false),[stage,setStage]=useState(0),[error,setError]=useState('');
  const [proposals,setProposals]=useState<DesignProposal[]>([]);
  const resultsHeading=useRef<HTMLHeadingElement>(null),applying=useRef(false);
  const pending=useRef<AbortController|null>(null),room=useMemo(createUrbanDemoRoom,[]);
  useEffect(()=>()=>{pending.current?.abort();},[]);
  useEffect(()=>{if(proposals.length)resultsHeading.current?.focus();},[proposals]);
  const cancel=()=>{pending.current?.abort();pending.current=null;setBusy(false);};
  const generate=async()=>{
    if(pending.current)return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setError('');setStage(0);
    try{
      const options=await runUrbanDemo(controller.signal,setStage);
      if(!controller.signal.aborted&&pending.current===controller)setProposals(options);
    }catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'The demo could not open. Please try again.');}
    finally{if(pending.current===controller){pending.current=null;setBusy(false);}}
  };
  return <Modal label="Design my room" onClose={()=>{cancel();onClose();}} className="designer-modal urban-demo-modal">
    <div className="designer-shell">
      <header className="designer-header"><div><span className="overline">YOUR ROOM, REIMAGINED</span><h2>Design my room<span>.</span></h2><p>One room. The same Amazon finds. Three ways to make it yours.</p></div><span className="urban-demo-badge"><Sparkles size={14}/>Prepared demo</span></header>
      <div className="urban-demo-disclosure"><strong>Urban High-Rise · demo mode</strong><span>Try any prompt, then choose from three prepared arrangements of this room. Live Claude generation is off.</span></div>
      {proposals.length?<section className="urban-demo-results" aria-labelledby="urban-demo-results-title">
        <div className="urban-demo-results-heading"><div><h3 id="urban-demo-results-title" ref={resultsHeading} tabIndex={-1}>Choose your arrangement</h3><p>Same five pieces, different placements. Open your favorite in 3D, then move anything or view it in AR.</p></div><button type="button" className="text-button" onClick={()=>setProposals([])}>Edit prompt</button></div>
        <div className="urban-demo-options">{proposals.map((proposal,index)=><article className="urban-demo-option" key={proposal.id} aria-labelledby={`option-${proposal.id}`}>
          <div className="urban-demo-option-plan"><FloorPlan layout={proposal.layout} compact/><span>OPTION 0{index+1}</span></div>
          <div className="urban-demo-option-copy"><h4 id={`option-${proposal.id}`}>{URBAN_DEMO_OPTIONS[index].name}</h4><p>{proposal.description}</p><span>5 pieces · same Amazon products</span><button type="button" className="button primary" onClick={()=>{if(applying.current)return;applying.current=true;onApply(proposal);}}>Use this design<ArrowRight size={16}/></button></div>
        </article>)}</div>
        <p className="urban-demo-model-note">Your current layouts stay unchanged. Only the arrangement you choose is saved as a new layout. Existing furniture appears as scan outlines; AR shows the five added products.</p>
        <div className="urban-demo-shopping">{URBAN_DEMO_PRODUCTS.map(product=><a href={product.url} key={product.asin} target="_blank" rel="noreferrer"><img src={product.image} alt=""/><div><strong>{product.name}</strong><span>{product.detail}</span><small>View on Amazon <ExternalLink size={12}/></small></div></a>)}</div>
      </section>:<form onSubmit={event=>{event.preventDefault();void generate();}} className="urban-demo-form">
        <div><label className="designer-label">What would make this room better?<textarea aria-label="Room design prompt" value={brief} onChange={event=>setBrief(event.target.value)} maxLength={1600} disabled={busy} rows={4} placeholder="Turn this into a modern urban high-rise room with statement art and warm lighting."/></label>
          <div className="designer-examples">{['An urban high-rise retreat','Add abstract artwork','Modern, warm and minimal'].map(text=><button type="button" key={text} disabled={busy} onClick={()=>setBrief(text)}>{text}</button>)}</div>
          <div className="urban-demo-palette"><span style={{background:'#e8dfcf'}}/><span style={{background:'#b69771'}}/><span style={{background:'#30302d'}}/><span>Cream · warm oak · charcoal</span></div>
          <p className="designer-hint">Uses the supplied LiDAR room. Your existing layouts stay unchanged. All five pieces can be moved in the regular editor afterward.</p>
        </div>
        <aside className="urban-demo-room"><FloorPlan layout={room} compact/><div><strong>The demonstration room</strong><span>{room.width.toFixed(2)} × {room.depth.toFixed(2)} m · bed, desk and chair retained as scan outlines</span></div></aside>
        <div className="urban-demo-shopping">{URBAN_DEMO_PRODUCTS.map(product=><a href={product.url} key={product.asin} target="_blank" rel="noreferrer"><img src={product.image} alt=""/><div><strong>{product.name}</strong><span>{product.detail}</span><small>View on Amazon <ExternalLink size={12}/></small></div></a>)}</div>
        <p className="urban-demo-model-note">Three real Amazon listings · five modeled pieces. Product-inspired 3D approximations; the art is sold as one set. Check current price and availability on Amazon.</p>
        {busy&&<div className="urban-demo-progress" role="status" aria-live="polite"><div><LoaderCircle size={20} className="spin"/><strong>{URBAN_DEMO_STAGES[stage]}…</strong><button type="button" className="text-button" onClick={cancel}>Cancel</button></div><ol>{URBAN_DEMO_STAGES.map((text,index)=><li key={text} className={index<=stage?'active':''}><span>{index<stage?<Check size={12}/>:index+1}</span>{text}</li>)}</ol><progress aria-label="Demo preparation progress" max={4} value={stage+1}/></div>}
        {error&&<p className="designer-error" role="alert">{error}</p>}
        <footer className="designer-form-footer"><span>Three prepared options · no AI or Amazon API calls</span><button className="button primary" type="submit" disabled={busy}>{busy?<><LoaderCircle size={17} className="spin"/>Preparing designs…</>:<>Generate designs<ArrowRight size={17}/></>}</button></footer>
      </form>}
    </div>
  </Modal>;
}
