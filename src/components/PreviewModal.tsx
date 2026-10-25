import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { ChevronRight, ExternalLink, FolderPlus, ImageOff, Plus, RotateCcw, ScanLine } from 'lucide-react';
import Modal from './Modal';
import type { ViewerHandle } from './Viewer';
import type { ProductItem, RoomLayout } from '../lib/workspace';
import { availableItemVariants, placeholderProduct, sourceLabel } from '../lib/workspace';
import { dimension, getVariant } from '../lib/products';
import type { Unit } from '../lib/products';
import FinishPicker from './FinishPicker';
import type { AmazonModel } from '../lib/amazon';
import type { ModelJob } from '../lib/model-jobs';
import './model-jobs.css';

const Viewer=lazy(()=>import('./Viewer').then(module=>({default:module.Viewer})));
interface Props {item:ProductItem;layouts:RoomLayout[];onVariant:(id:string)=>void;onGenerate:()=>void;onCheckModel:()=>void;modelJob?:ModelJob;onAdd:(id:string)=>void;onNew:()=>void;onClose:()=>void;onUnavailable:()=>void;unit:Unit;onUnit:(unit:Unit)=>void}
function modelMessage(model?: AmazonModel): string {
  switch(model?.status){
    case 'pending':return 'Preparing 3D model…';
    case 'failed':return '3D generation failed. Try again.';
    case 'storage_unavailable':return '3D models are temporarily unavailable.';
    case 'no_image':return '';
    case 'not_configured':return '3D generation is temporarily unavailable.';
    case 'ready':return '3D model ready.';
    default:return '';
  }
}
export default function PreviewModal({item,layouts,onVariant,onGenerate,onCheckModel,modelJob,onAdd,onNew,onClose,onUnavailable,unit,onUnit}:Props){
  const viewer=useRef<ViewerHandle>(null),[ready,setReady]=useState(false),[status,setStatus]=useState(''),[choosing,setChoosing]=useState(false);
  // Amazon previews never mount the model viewer or download a GLB until chosen.
  const [view,setView]=useState<'3d'|'photo'>(item.product&&!item.listing?'3d':'photo'),[photo,setPhoto]=useState(0),[imageFailed,setImageFailed]=useState(false);
  const onReady=useCallback((value:boolean)=>setReady(value),[]),onStatus=useCallback((value:string)=>setStatus(value),[]);
  const product=item.product,listing=item.listing,variants=availableItemVariants(item);
  const model=listing?.model,job=modelJob?.asin===listing?.asin?modelJob:undefined;
  const busy=!product&&(job?['starting','pending','checking'].includes(job.state):model?.status==='pending');
  const paused=!product&&job?.state==='paused';
  const failed=job?.state==='failed'||model?.status==='failed';
  const stage=job?.state==='starting'?'Starting model':job?.state==='checking'?'Checking progress':({preparing:'Preparing photo',reconstructing:'Building 3D shape',texturing:'Adding color',exporting:'Finishing model'} as const)[model?.stage??'preparing'];
  const canGenerate=!!listing&&!product&&!busy&&!paused&&model?.status!=='no_image';
  const currentVariant=product?getVariant(product,item.variantId):undefined;
  const variant=variants.find(option=>option.id===currentVariant?.id)??currentVariant,productUrl=variant?.productUrl??item.sourceUrl;
  const changedColor=Boolean(listing&&variant?.asin&&variant.asin!==listing.asin);
  const selectedPhoto=changedColor?listing?.colors?.options.find(option=>option.asin===variant?.asin)?.imageUrl:undefined;
  const images=selectedPhoto?[selectedPhoto]:listing?.images||[],originalColorPhotos=changedColor&&!selectedPhoto;
  const isSample=!listing&&product?.id===placeholderProduct.id;
  const dimensions=product?.dimensions||listing?.dimensions;
  const scaleKnown=product?.scaleReference!=='preview';
  const chooseVariant=(id:string)=>{if(!variants.some(option=>option.id===id))return;setStatus('');setPhoto(0);setImageFailed(false);onVariant(id);};
  const arVariants=variant?variants.filter(option=>option.modelSrc===variant.modelSrc):[];
  const colorControls=variant&&arVariants.length>0&&(arVariants.length>1||!arVariants.some(option=>option.id===variant.id))?<FinishPicker variants={arVariants} selected={variant} onChange={chooseVariant} listing={listing} compact/>:undefined;
  return <Modal label="Product preview" onClose={onClose} className="product-modal"><div className="product-detail">
    <div className={`product-stage ${busy&&view==='photo'?'reconstructing':''}`}>
      <div className="stage-top"><span className="model-tag tag">{view==='photo'?(originalColorPhotos?'Imported color photo':'Amazon photo'):isSample?'Sample model':listing?'Approximate model':'3D model'}</span></div>
      {product&&variant&&view==='3d'?<Suspense fallback={<div className="preview-viewer-loading" role="status"><span className="loading-ring"/>Loading 3D preview…</div>}><Viewer ref={viewer} src={variant.modelSrc} iosSrc={variant.iosSrc} materialOverrides={variant.materialOverrides} arControls={colorControls} name={`${item.name} in ${variant.name}`} interactive ar={scaleKnown} expectedDimensions={product.dimensions} onReady={onReady} onStatus={onStatus} onUnavailable={onUnavailable}/></Suspense>:<div className="listing-photo">{images[photo]&&!imageFailed?<img src={images[photo]} alt={item.name} referrerPolicy="no-referrer" onError={()=>setImageFailed(true)}/>:<div className="photo-empty"><ImageOff size={32}/><span>Product photo unavailable</span></div>}</div>}
      <div className="stage-bottom"><span>{view==='3d'?'Drag to rotate · Pinch to zoom':`${images.length?`${photo+1} / ${images.length} · `:''}${originalColorPhotos?'Original color':'Amazon photo'}`}</span>{view==='3d'&&<button className="icon-button" aria-label="Reset view" title="Reset view" onClick={()=>viewer.current?.reset()}><RotateCcw size={17}/></button>}{view==='photo'&&images.length>1&&<button className="icon-button" aria-label="Next product photo" title="Next photo" onClick={()=>{setPhoto(i=>(i+1)%images.length);setImageFailed(false);}}><ChevronRight size={16}/></button>}</div>
      {listing&&product&&images.length>0&&<div className="product-view-options segmented"><button aria-pressed={view==='3d'} className={view==='3d'?'active':''} onClick={()=>{if(view!=='3d'){setView('3d');setReady(false);setStatus('');}}}>3D model</button><button aria-pressed={view==='photo'} className={view==='photo'?'active':''} onClick={()=>setView('photo')}>Photos</button></div>}
    </div>
    <div className="product-panel">
      {listing?.brand&&<p className="product-brand">{listing.brand}</p>}<h2 className={listing?'listing-title':''}>{item.name}</h2>
      <a className="source-link" href={productUrl} target="_blank" rel="noreferrer">{sourceLabel(productUrl)} <ExternalLink size={12}/></a>
      {listing&&<div className="listing-price">{listing.price?<strong>{new Intl.NumberFormat('en-US',{style:'currency',currency:listing.price.currency}).format(listing.price.amount)}</strong>:<span>Price unavailable</span>}{listing.availability&&<span>{listing.availability}</span>}<small>{changedColor?'Price and stock are for the original color.':model?.source==='cache'?'Saved price and stock.':'Price and stock at import.'}</small></div>}
      <p className="preview-disclosure">{listing?(product?listing.modelNote:busy||paused?'':modelMessage(model)):isSample?'Sample table · Approximate colors. Check the linked listing for availability.':product?.description}</p>
      {!product&&listing&&(busy||paused)&&<div className="preview-model-progress" role="status" aria-live="polite">
        <div className="preview-model-progress-title">{busy&&<span className="loading-ring"/>}<strong>{paused?'Generation may still be running':`${stage}…`}</strong></div>
        <p>{paused?'Automatic checks paused. Check progress to resume.':'Continues in the background. Track progress in 3D models.'}</p>
        {job?.message&&<p className="preview-model-notice">{job.message}</p>}
        {paused&&<button className="text-button" onClick={onCheckModel}>Check progress</button>}
      </div>}
      {!product&&!busy&&!paused&&job?.message&&<p className="status-text preview-model-notice" role="status">{job.message}</p>}
      {product&&variant&&<FinishPicker variants={variants} selected={variant} onChange={chooseVariant} listing={listing}/>}
      {!product&&listing&&<div className="listing-colors"><strong>Amazon colors</strong>{listing.colors?.status==='observed'&&listing.colors.options.length?<><p>{listing.colors.options.map(option=>option.name).join(' · ')}</p><small>Colors at import · 3D previews may vary.</small></>:<p>Color options unavailable.</p>}</div>}
      <div className="dimension-heading"><span>{product?(scaleKnown?'Dimensions':'Reference dimensions'):'Listed dimensions'}</span><div className="unit-toggle segmented"><button aria-pressed={unit==='cm'} onClick={()=>onUnit('cm')}>cm</button><button aria-pressed={unit==='in'} onClick={()=>onUnit('in')}>in</button></div></div>
      <div className="dimension-values">{(['width','depth','height'] as const).map(key=><div key={key}><span>{key}</span><strong>{dimensions?.[key]!=null?dimension(dimensions[key]!,unit):'—'}{dimensions?.[key]!=null&&<small>{unit}</small>}</strong></div>)}</div>
      {listing?.dimensionText&&<p className="listing-measurements"><strong>Amazon lists</strong> {listing.dimensionText}</p>}
      {product?<><button className="button primary" disabled={view==='3d'&&(!ready||!scaleKnown)} onClick={()=>{if(view==='photo'){setView('3d');setReady(false);setStatus('');}else viewer.current?.startAR();}}><ScanLine size={18}/>{view==='photo'?'Load 3D model':!scaleKnown?'Measurements needed for AR':ready?'View in your room':status?'AR unavailable':'Loading model…'}</button><button className="button secondary" disabled={!scaleKnown} aria-expanded={choosing} onClick={()=>setChoosing(!choosing)}><FolderPlus size={17}/>Add to layout</button></>:canGenerate?<div className="preview-model-choice"><button className="button primary" onClick={onGenerate}><ScanLine size={18}/>{failed?'Retry generation':'Generate 3D model'}</button><p>Runs in the background. Track progress in 3D models.</p></div>:!busy&&!paused?<div className="notice"><ScanLine size={18}/><span>A product photo is needed for 3D & AR.</span></div>:null}
      {choosing&&product&&<div className="layout-picker"><span>Choose a layout</span>{layouts.map(room=><button key={room.id} onClick={()=>onAdd(room.id)}>{room.name}<ChevronRight size={16}/></button>)}<button onClick={onNew}><Plus size={15}/>New layout</button></div>}
      {status&&view==='3d'&&<p className="status-text" role="status">{status}</p>}{variants.length>1&&<p className="color-ar-note">iPhone: choose a color before opening AR.</p>}{product&&<p className="ar-footnote">{scaleKnown?'Actual scale · Check fit in your room':'Reference size · Not measured from the photo'}</p>}
    </div>
  </div></Modal>;
}
