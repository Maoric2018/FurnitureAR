import { useCallback, useRef, useState } from 'react';
import { ArrowUpRight, Heart, Move3d, RotateCcw, Ruler, ScanLine, ShieldCheck } from 'lucide-react';
import type { FurnitureProduct, Unit } from '../lib/products';
import { dimension, getVariant } from '../lib/products';
import { Viewer } from './Viewer';
import type { ViewerHandle } from './Viewer';
import Modal from './Modal';
import FinishPicker from './FinishPicker';
interface Props {
  product: FurnitureProduct; initialVariant: string; unit: Unit; onUnit: (unit:Unit)=>void;
  saved: (id:string,variant:string)=>boolean; onSave:(product:FurnitureProduct,variant:string)=>void;
  onClose:()=>void; onUnavailable:()=>void; demoLink?:string;
}
export default function ProductDetail({product,initialVariant,unit,onUnit,saved,onSave,onClose,onUnavailable,demoLink}:Props) {
  const [variantId,setVariantId]=useState(initialVariant);
  const variant=getVariant(product,variantId);
  const [ready,setReady]=useState(false), [status,setStatus]=useState('');
  const [showDimensions,setShowDimensions]=useState(true);
  const viewer=useRef<ViewerHandle>(null);
  const onReady=useCallback((value:boolean)=>setReady(value),[]);
  const onStatus=useCallback((value:string)=>setStatus(value),[]);
  const isSaved=saved(product.id,variant.id);
  const chooseVariant=(id:string)=>{setStatus('');setVariantId(id);};
  const arVariants=product.variants.filter(option=>option.modelSrc===variant.modelSrc);
  return <Modal label={product.name} onClose={onClose} className="product-modal">
    <div className="detail-layout">
      <div className="detail-stage" style={{background:product.background}}>
        <span className="eyebrow stage-label"><span className="pulse-dot"/> INTERACTIVE 3D</span>
        <Viewer ref={viewer} src={variant.modelSrc} iosSrc={variant.iosSrc} materialOverrides={variant.materialOverrides} arControls={arVariants.length>1?<FinishPicker variants={arVariants} selected={variant} onChange={chooseVariant} compact/>:undefined} name={`${product.name} in ${variant.name}`} interactive ar expectedDimensions={product.dimensions} onReady={onReady} onStatus={onStatus} onUnavailable={onUnavailable}/>
        {showDimensions && <div className="dimension-line"><span/><span>{dimension(product.dimensions.width,unit)} {unit} wide</span><span/></div>}
        <div className="stage-controls"><span><Move3d size={15}/> Drag to rotate · pinch to zoom</span><div><button className={`icon-button ${showDimensions?'active':''}`} aria-label="Toggle dimensions" aria-pressed={showDimensions} onClick={()=>setShowDimensions(v=>!v)}><Ruler size={18}/></button><button className="icon-button" aria-label="Reset 3D view" onClick={()=>viewer.current?.reset()}><RotateCcw size={17}/></button></div></div>
      </div>
      <div className="detail-info">
        <span className="eyebrow">{product.category} <span className="tiny-separator">/</span> {demoLink ? 'Amazon link demo' : 'Sample collection'}</span>
        <h2>{product.name}</h2><p className="detail-tagline">{product.tagline}</p>
        <FinishPicker variants={product.variants} selected={variant} onChange={chooseVariant}/>
        <div className="dimensions-heading"><span>Made to measure</span><div className="unit-toggle" aria-label="Measurement units"><button aria-pressed={unit==='cm'} onClick={()=>onUnit('cm')}>cm</button><button aria-pressed={unit==='in'} onClick={()=>onUnit('in')}>in</button></div></div>
        <div className="dimensions-grid">{(['width','depth','height'] as const).map(key=><div key={key}><span>{key}</span><strong>{dimension(product.dimensions[key],unit)}<small>{unit}</small></strong></div>)}</div>
        <p className="detail-description">{product.description}</p><p className="material-note">{product.material}</p>
        <button className="button primary ar-launch" disabled={!ready} onClick={()=>viewer.current?.startAR()}><ScanLine size={20}/>{ready?'View in your room':status?'AR unavailable':'Loading your piece…'}<ArrowUpRight size={18}/></button>
        <button className={`button save-button ${isSaved?'is-saved':''}`} onClick={()=>onSave(product,variant.id)}><Heart size={17} fill={isSaved?'currentColor':'none'}/>{isSaved?'Saved to your collection':'Save for later'}</button>
        {product.variants.length>1&&<p className="color-ar-note">On iPhone, choose a color before opening AR. To change it, return here.</p>}
        <p className="scale-note"><ShieldCheck size={14}/> Actual size in AR. Scaling is locked.</p>
        <p className="ar-status" role="status">{status}</p>
        {demoLink && <div className="import-notice"><strong>A preview of what’s next.</strong><p>The Amazon importer isn’t connected yet. This is sample furniture, not the product from your link.</p><a href={variant.productUrl??demoLink} target="_blank" rel="noreferrer">Your Amazon link <ArrowUpRight size={13}/></a></div>}
      </div>
    </div>
  </Modal>;
}
