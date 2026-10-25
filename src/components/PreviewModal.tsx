import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, Check, ExternalLink, FolderPlus, ImageOff, Plus, RotateCcw, ScanLine } from 'lucide-react';
import Modal from './Modal';
import { Viewer } from './Viewer';
import type { ViewerHandle } from './Viewer';
import type { ProductItem, RoomLayout } from '../lib/workspace';
import { availableItemVariants, placeholderProduct, sourceLabel } from '../lib/workspace';
import { dimension, getVariant } from '../lib/products';
import type { Unit } from '../lib/products';
import FinishPicker from './FinishPicker';
import { getAmazonProductModel, ImportError } from '../lib/amazon';
import type { AmazonModel, AmazonProductResult } from '../lib/amazon';
interface Props {item:ProductItem;layouts:RoomLayout[];saved:boolean;onVariant:(id:string)=>void;onResolved:(id:string,result:AmazonProductResult)=>void;onSave:()=>void;onAdd:(id:string)=>void;onNew:()=>void;onClose:()=>void;onUnavailable:()=>void;unit:Unit;onUnit:(unit:Unit)=>void}
function modelMessage(model?: AmazonModel): string {
  switch(model?.status){
    case 'pending':return `${({preparing:'Preparing the product photo',reconstructing:'Reconstructing the 3D shape',texturing:'Adding its appearance',exporting:'Preparing the GLB model'} as const)[model.stage??'preparing']}… You can save this item while it runs.`;
    case 'failed':return 'The 3D model is not available yet. You can check its status again later.';
    case 'storage_unavailable':return 'Saved models are temporarily unavailable. You can save this item and check again later.';
    case 'no_image':return 'This product has no usable photo for a 3D model yet. You can still save its details.';
    case 'ready':return model.source==='cache'?'Saved 3D model reused for this exact Amazon product. Product details are a saved snapshot.':model.source==='generated'?'3D model prepared from this product’s photo. Review its shape and measurements before placing it.':'';
    default:return '3D generation is being connected. You can save this item now; its model will be reused once available.';
  }
}
export default function PreviewModal({item,layouts,saved,onVariant,onResolved,onSave,onAdd,onNew,onClose,onUnavailable,unit,onUnit}:Props){
  const viewer=useRef<ViewerHandle>(null),[ready,setReady]=useState(false),[status,setStatus]=useState(''),[choosing,setChoosing]=useState(false);
  const [view,setView]=useState<'3d'|'photo'>(item.product?'3d':'photo'),[photo,setPhoto]=useState(0),[imageFailed,setImageFailed]=useState(false);
  const onReady=useCallback((value:boolean)=>setReady(value),[]),onStatus=useCallback((value:string)=>setStatus(value),[]);
  const product=item.product,listing=item.listing,variants=availableItemVariants(item);
  const [checking,setChecking]=useState(false),[modelCheck,setModelCheck]=useState(''),[checkVersion,setCheckVersion]=useState(0);
  const model=listing?.model;
  // Poll only saved model status. This endpoint never repeats the Amazon lookup.
  // Stop on completion, after twenty minutes, or as soon as this preview is closed.
  const resolution=useRef(onResolved);resolution.current=onResolved;
  const manualRun=useRef(0),savedCheck=useRef<string|null>(null);
  useEffect(()=>{
    const manual=manualRun.current!==checkVersion,checkSaved=saved&&savedCheck.current!==item.id;
    if(!listing||product||(model?.status!=='pending'&&!manual&&!checkSaved))return;
    manualRun.current=checkVersion;if(checkSaved)savedCheck.current=item.id;
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    let requestTimeout:ReturnType<typeof setTimeout>|undefined,attempts=0;
    let active=true,timedOut=false;
    const deadline=Date.now()+1200000,asin=listing.asin,id=item.id;
    const delay=(value?:number)=>Math.max(2000,Math.min(15000,value??4000));
    const check=async()=>{
      if(controller.signal.aborted)return;
      if(attempts>=400||Date.now()>=deadline){setChecking(false);setModelCheck('The model is still being prepared. You can check again later.');return;}
      attempts++;setChecking(true);setModelCheck('');
      requestTimeout=setTimeout(()=>{timedOut=true;controller.abort();},20000);
      try{
        const result=await getAmazonProductModel(asin,controller.signal);
        if(controller.signal.aborted)return;
        if(result.listing.model?.status==='pending'){
          resolution.current(id,result);
          if(model?.status!=='pending')return;
          timer=setTimeout(()=>void check(),delay(result.listing.model.retryAfterMs));
        }else{
          setChecking(false);resolution.current(id,result);
          if(result.product){setReady(false);setStatus('');setView('3d');}
        }
      }catch(error){
        if(active){setChecking(false);setModelCheck(timedOut?'Checking the model took too long. Please try again.':error instanceof ImportError?error.message:'Could not check the saved model. Please try again.');}
      }finally{
        if(requestTimeout)clearTimeout(requestTimeout);
      }
    };
    setModelCheck('');
    timer=setTimeout(()=>void check(),manual||checkSaved?0:delay(model?.retryAfterMs));
    return()=>{active=false;controller.abort();if(timer)clearTimeout(timer);if(requestTimeout)clearTimeout(requestTimeout);};
    // Keep a polling run alive while its metadata stays pending; the item ID
    // and ASIN prevent one product's late response from updating another.
  },[item.id,listing?.asin,model?.status,checkVersion,saved,!!product]);
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
      {product&&variant&&view==='3d'?<Viewer ref={viewer} src={variant.modelSrc} iosSrc={variant.iosSrc} materialOverrides={variant.materialOverrides} arControls={colorControls} name={`${item.name} in ${variant.name}`} interactive ar={scaleKnown} expectedDimensions={product.dimensions} onReady={onReady} onStatus={onStatus} onUnavailable={onUnavailable}/>:<div className="listing-photo">{images[photo]&&!imageFailed?<img src={images[photo]} alt={item.name} referrerPolicy="no-referrer" onError={()=>setImageFailed(true)}/>:<div className="photo-empty"><ImageOff size={32}/><span>Product photo unavailable</span></div>}</div>}
      <div className="stage-bottom"><span>{view==='3d'?'Drag to rotate. Pinch to zoom.':`${images.length?`${photo+1} / ${images.length} · `:''}${originalColorPhotos?'Photos of the imported color':'Product photography from Amazon'}`}</span>{view==='3d'&&<button className="icon-button" aria-label="Reset view" onClick={()=>viewer.current?.reset()}><RotateCcw size={17}/></button>}</div>
      {listing&&<div className="product-view-options">{product&&<button className={view==='3d'?'active':''} onClick={()=>{setView('3d');setStatus('');}}>3D model</button>}{images.length>0&&<button className={view==='photo'?'active':''} onClick={()=>setView('photo')}>Product photos</button>}{view==='photo'&&images.length>1&&<button aria-label="Next product photo" onClick={()=>{setPhoto(i=>(i+1)%images.length);setImageFailed(false);}}>Next photo <ArrowUpRight size={14}/></button>}</div>}
    </div>
    <div className="product-panel">
      <div className="overline">{listing?.brand||'SINGLE PRODUCT'}</div><h2 className={listing?'listing-title':''}>{item.name}</h2>
      <a className="source-link" href={productUrl} target="_blank" rel="noreferrer">{sourceLabel(productUrl)} <ExternalLink size={12}/></a>
      {listing&&<div className="listing-price">{changedColor&&<small>Imported color price & availability</small>}{listing.price?<strong>{new Intl.NumberFormat('en-US',{style:'currency',currency:listing.price.currency}).format(listing.price.amount)}</strong>:<span>Price unavailable</span>}{listing.availability&&<span>{listing.availability}</span>}<small>{changedColor?'These details apply to the original imported color.':model?.source==='cache'?'Saved price & availability; not refreshed from Amazon.':'Price & availability at import.'} <a href={productUrl} target="_blank" rel="noreferrer">Check the selected color on Amazon <ExternalLink size={11}/></a></small></div>}
      <p className="preview-disclosure">{listing?(product?listing.modelNote:modelMessage(model)):isSample?'Sample table with approximate color previews. Live listing colors and availability have not been checked. Your original link stays attached.':product?.description}</p>
      {product&&modelMessage(model)&&model?.status==='ready'&&<p className="preview-disclosure" role="status">{modelMessage(model)}</p>}
      {!product&&model?.status==='pending'&&<div className="generation-inline" role="status"><span className="loading-ring"/><span>Photo → 3D shape → GLB preview</span></div>}
      {!product&&listing&&((model?.status!=='not_configured'&&model?.status!=='no_image')||checking||modelCheck)&&<div className="model-check"><button className="text-button" onClick={()=>{setChecking(false);setCheckVersion(value=>value+1);}} disabled={checking}> {checking?'Checking saved model…':'Check model again'}</button>{modelCheck&&<p className="status-text" role="status">{modelCheck}</p>}</div>}
      {product&&variant&&<FinishPicker variants={variants} selected={variant} onChange={chooseVariant} listing={listing}/>}
      {!product&&listing&&<div className="listing-colors"><strong>Amazon colors</strong>{listing.colors?.status==='observed'&&listing.colors.options.length?<><p>{listing.colors.options.map(option=>option.name).join(' · ')}</p><small>Listed at import. Color previews need a matching 3D model.</small></>:<p>Amazon hasn’t confirmed color options for this item.</p>}</div>}
      <div className="dimension-heading"><span>{product?(scaleKnown?'Model dimensions':'Reference preview dimensions'):'Listed dimensions'}</span><div className="unit-toggle"><button aria-pressed={unit==='cm'} onClick={()=>onUnit('cm')}>cm</button><button aria-pressed={unit==='in'} onClick={()=>onUnit('in')}>in</button></div></div>
      <div className="dimension-values">{(['width','depth','height'] as const).map(key=><div key={key}><span>{key}</span><strong>{dimensions?.[key]!=null?dimension(dimensions[key]!,unit):'—'}{dimensions?.[key]!=null&&<small>{unit}</small>}</strong></div>)}</div>
      {listing?.dimensionText&&<p className="listing-measurements"><strong>Amazon lists</strong> {listing.dimensionText}</p>}
      {product?<><button className="button primary" disabled={view==='3d'&&(!ready||!scaleKnown)} onClick={()=>{if(view==='photo'){setView('3d');setStatus('');}else viewer.current?.startAR();}}><ScanLine size={18}/>{view==='photo'?'Open 3D preview':!scaleKnown?'Measurements needed for AR':ready?'View in your room':status?'AR unavailable':'Loading model…'}<ArrowUpRight size={17}/></button><button className="button secondary" disabled={!scaleKnown} onClick={()=>setChoosing(!choosing)}><FolderPlus size={17}/>Add to a layout</button></>:<div className="model-pending"><ScanLine size={18}/><span>3D & AR will be available when this product has a model.</span></div>}
      <button className="text-button save-item" onClick={onSave}>{saved?<Check size={15}/>:<Bookmark size={15}/>} {saved?'Saved to your items':'Save item'}</button>
      {choosing&&product&&<div className="layout-picker"><span>CHOOSE A LAYOUT</span>{layouts.map(room=><button key={room.id} onClick={()=>onAdd(room.id)}>{room.name}<ArrowUpRight size={14}/></button>)}<button onClick={onNew}><Plus size={15}/>Create a new layout</button></div>}
      {status&&view==='3d'&&<p className="status-text" role="status">{status}</p>}{variants.length>1&&<p className="color-ar-note">On iPhone, choose a color before opening AR. To change it, return here.</p>}{product&&<p className="ar-footnote">{scaleKnown?'Fixed model scale · iPhone & Android':'Reference size only · Not measured from the photo'}</p>}
    </div>
  </div></Modal>;
}
