import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, Check, ExternalLink, FolderPlus, ImageOff, Plus, RotateCcw, ScanLine } from 'lucide-react';
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
interface Props {item:ProductItem;layouts:RoomLayout[];saved:boolean;onVariant:(id:string)=>void;onGenerate:()=>void;onCheckModel:()=>void;modelJob?:ModelJob;onSave:()=>void;onAdd:(id:string)=>void;onNew:()=>void;onClose:()=>void;onUnavailable:()=>void;unit:Unit;onUnit:(unit:Unit)=>void}
function modelMessage(model?: AmazonModel): string {
  switch(model?.status){
    case 'pending':return 'Your 3D model is being prepared. You can keep browsing while it runs.';
    case 'failed':return 'This model could not be prepared. You can try again or keep browsing its photos.';
    case 'storage_unavailable':return '3D models are temporarily unavailable. You can still browse photos and save this item.';
    case 'no_image':return 'This product has no usable photo for a 3D model yet. You can still save its details.';
    case 'not_configured':return '3D generation is temporarily unavailable. You can still browse photos and save this item.';
    case 'ready':return model.source==='cache'?'A saved 3D model is available for this product. Load it whenever you’re ready.':model.source==='generated'?'Your 3D model is ready. Review its shape and measurements before placing it.':'';
    default:return 'Browse the product photos, or choose to generate a 3D model for your room.';
  }
}
export default function PreviewModal({item,layouts,saved,onVariant,onGenerate,onCheckModel,modelJob,onSave,onAdd,onNew,onClose,onUnavailable,unit,onUnit}:Props){
  const viewer=useRef<ViewerHandle>(null),[ready,setReady]=useState(false),[status,setStatus]=useState(''),[choosing,setChoosing]=useState(false);
  // Amazon previews never mount the model viewer or download a GLB until chosen.
  const [view,setView]=useState<'3d'|'photo'>(item.product&&!item.listing?'3d':'photo'),[photo,setPhoto]=useState(0),[imageFailed,setImageFailed]=useState(false);
  const onReady=useCallback((value:boolean)=>setReady(value),[]),onStatus=useCallback((value:string)=>setStatus(value),[]);
  const product=item.product,listing=item.listing,variants=availableItemVariants(item);
  const model=listing?.model,job=modelJob?.asin===listing?.asin?modelJob:undefined;
  const busy=!product&&(job?['starting','pending','checking'].includes(job.state):model?.status==='pending');
  const paused=!product&&job?.state==='paused';
  const failed=job?.state==='failed'||model?.status==='failed';
  const stage=job?.state==='starting'?'Starting your 3D model':job?.state==='checking'?'Checking your 3D model':({preparing:'Preparing your product photo',reconstructing:'Building its 3D shape',texturing:'Adding its appearance',exporting:'Finishing your 3D model'} as const)[model?.stage??'preparing'];
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
    <div className="product-stage">
      <div className="stage-top"><span>PRODUCT PREVIEW</span><span className="model-tag">{view==='photo'?(originalColorPhotos?'IMPORTED COLOR PHOTO':'AMAZON PHOTO'):isSample?'SAMPLE MODEL':listing?'APPROXIMATE MODEL':'3D MODEL'}</span></div>
      {product&&variant&&view==='3d'?<Suspense fallback={<div className="preview-viewer-loading" role="status"><span className="loading-ring"/>Opening your 3D preview…</div>}><Viewer ref={viewer} src={variant.modelSrc} iosSrc={variant.iosSrc} materialOverrides={variant.materialOverrides} arControls={colorControls} name={`${item.name} in ${variant.name}`} interactive ar={scaleKnown} expectedDimensions={product.dimensions} onReady={onReady} onStatus={onStatus} onUnavailable={onUnavailable}/></Suspense>:<div className="listing-photo">{images[photo]&&!imageFailed?<img src={images[photo]} alt={item.name} referrerPolicy="no-referrer" onError={()=>setImageFailed(true)}/>:<div className="photo-empty"><ImageOff size={32}/><span>Product photo unavailable</span></div>}</div>}
      <div className="stage-bottom"><span>{view==='3d'?'Drag to rotate. Pinch to zoom.':`${images.length?`${photo+1} / ${images.length} · `:''}${originalColorPhotos?'Photos of the imported color':'Product photography from Amazon'}`}</span>{view==='3d'&&<button className="icon-button" aria-label="Reset view" onClick={()=>viewer.current?.reset()}><RotateCcw size={17}/></button>}</div>
      {listing&&<div className="product-view-options">{product&&<button className={view==='3d'?'active':''} onClick={()=>{if(view!=='3d'){setView('3d');setReady(false);setStatus('');}}}>{view==='3d'?'3D model':'Load 3D model'}</button>}{images.length>0&&<button className={view==='photo'?'active':''} onClick={()=>setView('photo')}>Product photos</button>}{view==='photo'&&images.length>1&&<button aria-label="Next product photo" onClick={()=>{setPhoto(i=>(i+1)%images.length);setImageFailed(false);}}>Next photo <ArrowUpRight size={14}/></button>}</div>}
    </div>
    <div className="product-panel">
      <div className="overline">{listing?.brand||'SINGLE PRODUCT'}</div><h2 className={listing?'listing-title':''}>{item.name}</h2>
      <a className="source-link" href={productUrl} target="_blank" rel="noreferrer">{sourceLabel(productUrl)} <ExternalLink size={12}/></a>
      {listing&&<div className="listing-price">{changedColor&&<small>Imported color price & availability</small>}{listing.price?<strong>{new Intl.NumberFormat('en-US',{style:'currency',currency:listing.price.currency}).format(listing.price.amount)}</strong>:<span>Price unavailable</span>}{listing.availability&&<span>{listing.availability}</span>}<small>{changedColor?'These details apply to the original imported color.':model?.source==='cache'?'Saved price & availability; not refreshed from Amazon.':'Price & availability at import.'} <a href={productUrl} target="_blank" rel="noreferrer">Check the selected color on Amazon <ExternalLink size={11}/></a></small></div>}
      <p className="preview-disclosure">{listing?(product?listing.modelNote:modelMessage(model)):isSample?'Sample table with approximate color previews. Live listing colors and availability have not been checked. Your original link stays attached.':product?.description}</p>
      {product&&modelMessage(model)&&model?.status==='ready'&&<p className="preview-disclosure" role="status">{modelMessage(model)}</p>}
      {!product&&listing&&(busy||paused)&&<div className="preview-model-progress" role="status" aria-live="polite">
        <div className="preview-model-progress-title">{busy&&<span className="loading-ring"/>}<strong>{paused?'Your model may still be generating':`${stage}…`}</strong></div>
        <p>{paused?'Automatic checks are paused. Check again to see the latest progress.':'You can close this preview and browse other items. Follow its progress in the 3D models panel.'}</p>
        {job?.message&&<p className="preview-model-notice">{job.message}</p>}
        {paused&&<button className="text-button" onClick={onCheckModel}>Check model status <ArrowUpRight size={14}/></button>}
        <button className="button secondary" onClick={onClose}>Keep browsing <ArrowUpRight size={16}/></button>
      </div>}
      {!product&&!busy&&!paused&&job?.message&&<p className="status-text preview-model-notice" role="status">{job.message}</p>}
      {product&&variant&&<FinishPicker variants={variants} selected={variant} onChange={chooseVariant} listing={listing}/>}
      {!product&&listing&&<div className="listing-colors"><strong>Amazon colors</strong>{listing.colors?.status==='observed'&&listing.colors.options.length?<><p>{listing.colors.options.map(option=>option.name).join(' · ')}</p><small>Listed at import. Color previews need a matching 3D model.</small></>:<p>Amazon hasn’t confirmed color options for this item.</p>}</div>}
      <div className="dimension-heading"><span>{product?(scaleKnown?'Model dimensions':'Reference preview dimensions'):'Listed dimensions'}</span><div className="unit-toggle"><button aria-pressed={unit==='cm'} onClick={()=>onUnit('cm')}>cm</button><button aria-pressed={unit==='in'} onClick={()=>onUnit('in')}>in</button></div></div>
      <div className="dimension-values">{(['width','depth','height'] as const).map(key=><div key={key}><span>{key}</span><strong>{dimensions?.[key]!=null?dimension(dimensions[key]!,unit):'—'}{dimensions?.[key]!=null&&<small>{unit}</small>}</strong></div>)}</div>
      {listing?.dimensionText&&<p className="listing-measurements"><strong>Amazon lists</strong> {listing.dimensionText}</p>}
      {product?<><button className="button primary" disabled={view==='3d'&&(!ready||!scaleKnown)} onClick={()=>{if(view==='photo'){setView('3d');setReady(false);setStatus('');}else viewer.current?.startAR();}}><ScanLine size={18}/>{view==='photo'?'Load 3D model':!scaleKnown?'Measurements needed for AR':ready?'View in your room':status?'AR unavailable':'Loading model…'}<ArrowUpRight size={17}/></button><button className="button secondary" disabled={!scaleKnown} onClick={()=>setChoosing(!choosing)}><FolderPlus size={17}/>Add to a layout</button></>:canGenerate?<div className="preview-model-choice"><button className="button primary" onClick={onGenerate}><ScanLine size={18}/>{failed?'Try generating again':'Generate 3D model'}<ArrowUpRight size={17}/></button><p>Optional. Generation runs in the background and saves this item for you.</p><button className="text-button" onClick={onClose}>Not now <ArrowUpRight size={14}/></button></div>:!busy&&!paused?<div className="model-pending"><ScanLine size={18}/><span>3D & AR need a usable product photo. You can save the item’s details now.</span></div>:null}
      <button className="text-button save-item" onClick={onSave}>{saved?<Check size={15}/>:<Bookmark size={15}/>} {saved?'Saved to your items':'Save item'}</button>
      {choosing&&product&&<div className="layout-picker"><span>CHOOSE A LAYOUT</span>{layouts.map(room=><button key={room.id} onClick={()=>onAdd(room.id)}>{room.name}<ArrowUpRight size={14}/></button>)}<button onClick={onNew}><Plus size={15}/>Create a new layout</button></div>}
      {status&&view==='3d'&&<p className="status-text" role="status">{status}</p>}{variants.length>1&&<p className="color-ar-note">On iPhone, choose a color before opening AR. To change it, return here.</p>}{product&&<p className="ar-footnote">{scaleKnown?'Fixed model scale · iPhone & Android':'Reference size only · Not measured from the photo'}</p>}
    </div>
  </div></Modal>;
}
