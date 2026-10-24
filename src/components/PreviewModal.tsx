import { useCallback, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, Check, ExternalLink, FolderPlus, ImageOff, Plus, RotateCcw, ScanLine } from 'lucide-react';
import Modal from './Modal';
import { Viewer } from './Viewer';
import type { ViewerHandle } from './Viewer';
import type { ProductItem, RoomLayout } from '../lib/workspace';
import { sourceLabel } from '../lib/workspace';
import { dimension } from '../lib/products';
import type { Unit } from '../lib/products';
interface Props {item:ProductItem;layouts:RoomLayout[];saved:boolean;onSave:()=>void;onAdd:(id:string)=>void;onNew:()=>void;onClose:()=>void;onUnavailable:()=>void;unit:Unit;onUnit:(unit:Unit)=>void}
export default function PreviewModal({item,layouts,saved,onSave,onAdd,onNew,onClose,onUnavailable,unit,onUnit}:Props){
  const viewer=useRef<ViewerHandle>(null),[ready,setReady]=useState(false),[status,setStatus]=useState(''),[choosing,setChoosing]=useState(false);
  const [view,setView]=useState<'3d'|'photo'>(item.product?'3d':'photo'),[photo,setPhoto]=useState(0),[imageFailed,setImageFailed]=useState(false);
  const onReady=useCallback((value:boolean)=>setReady(value),[]),onStatus=useCallback((value:string)=>setStatus(value),[]);
  const product=item.product,listing=item.listing,images=listing?.images||[];
  const dimensions=product?.dimensions||listing?.dimensions;
  return <Modal label="Product preview" onClose={onClose} className="product-modal"><div className="product-detail">
    <div className="product-stage">
      <div className="stage-top"><span>PRODUCT PREVIEW</span><span className="model-tag">{view==='photo'?'AMAZON PHOTO':listing?'APPROXIMATE MODEL':'PLACEHOLDER MODEL'}</span></div>
      {product&&view==='3d'?<Viewer key={product.id} ref={viewer} src={product.variants[0].modelSrc} name={item.name} interactive ar expectedDimensions={product.dimensions} onReady={onReady} onStatus={onStatus} onUnavailable={onUnavailable}/>:<div className="listing-photo">{images[photo]&&!imageFailed?<img src={images[photo]} alt={item.name} referrerPolicy="no-referrer" onError={()=>setImageFailed(true)}/>:<div className="photo-empty"><ImageOff size={32}/><span>Product photo unavailable</span></div>}</div>}
      <div className="stage-bottom"><span>{view==='3d'?'Drag to rotate. Pinch to zoom.':`${images.length?`${photo+1} / ${images.length} · `:''}Product photography from Amazon`}</span>{view==='3d'&&<button className="icon-button" aria-label="Reset view" onClick={()=>viewer.current?.reset()}><RotateCcw size={17}/></button>}</div>
      {listing&&<div className="product-view-options">{product&&<button className={view==='3d'?'active':''} onClick={()=>{setView('3d');setStatus('');}}>3D model</button>}{images.length>0&&<button className={view==='photo'?'active':''} onClick={()=>setView('photo')}>Product photos</button>}{view==='photo'&&images.length>1&&<button aria-label="Next product photo" onClick={()=>{setPhoto(i=>(i+1)%images.length);setImageFailed(false);}}>Next photo <ArrowUpRight size={14}/></button>}</div>}
    </div>
    <div className="product-panel">
      <div className="overline">{listing?.brand||'SINGLE PRODUCT'}</div><h2 className={listing?'listing-title':''}>{item.name}</h2>
      <a className="source-link" href={item.sourceUrl} target="_blank" rel="noreferrer">{sourceLabel(item.sourceUrl)} <ExternalLink size={12}/></a>
      {listing&&<div className="listing-price">{listing.price?<strong>{new Intl.NumberFormat('en-US',{style:'currency',currency:listing.price.currency}).format(listing.price.amount)}</strong>:<span>Price unavailable</span>}{listing.availability&&<span>{listing.availability}</span>}<small>Price at import · confirm on Amazon</small></div>}
      <p className="preview-disclosure">{listing?(product?listing.modelNote:'Product details imported. A matching 3D model is not available yet. You can save this item while model generation is being connected.'):'This saved preview uses the Little Tree placeholder. Import an Amazon link to load current product details.'}</p>
      <div className="dimension-heading"><span>{product?'Model dimensions':'Listed dimensions'}</span><div className="unit-toggle"><button aria-pressed={unit==='cm'} onClick={()=>onUnit('cm')}>cm</button><button aria-pressed={unit==='in'} onClick={()=>onUnit('in')}>in</button></div></div>
      <div className="dimension-values">{(['width','depth','height'] as const).map(key=><div key={key}><span>{key}</span><strong>{dimensions?.[key]!=null?dimension(dimensions[key]!,unit):'—'}{dimensions?.[key]!=null&&<small>{unit}</small>}</strong></div>)}</div>
      {listing?.dimensionText&&<p className="listing-measurements"><strong>Amazon lists</strong> {listing.dimensionText}</p>}
      {product?<><button className="button primary" disabled={view==='3d'&&!ready} onClick={()=>{if(view==='photo'){setView('3d');setStatus('');}else viewer.current?.startAR();}}><ScanLine size={18}/>{view==='photo'?'Open 3D preview':ready?'View in your room':status?'AR unavailable':'Loading model…'}<ArrowUpRight size={17}/></button><button className="button secondary" onClick={()=>setChoosing(!choosing)}><FolderPlus size={17}/>Add to a layout</button></>:<div className="model-pending"><ScanLine size={18}/><span>3D & AR will be available when this product has a model.</span></div>}
      <button className="text-button save-item" onClick={onSave}>{saved?<Check size={15}/>:<Bookmark size={15}/>} {saved?'Saved to your items':'Save item'}</button>
      {choosing&&product&&<div className="layout-picker"><span>CHOOSE A LAYOUT</span>{layouts.map(room=><button key={room.id} onClick={()=>onAdd(room.id)}>{room.name}<ArrowUpRight size={14}/></button>)}<button onClick={onNew}><Plus size={15}/>Create a new layout</button></div>}
      {status&&view==='3d'&&<p className="status-text" role="status">{status}</p>}{product&&<p className="ar-footnote">Fixed model scale · iPhone & Android</p>}
    </div>
  </div></Modal>;
}
