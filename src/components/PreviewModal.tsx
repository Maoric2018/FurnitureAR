import { useCallback, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, Check, ExternalLink, FolderPlus, Plus, RotateCcw, ScanLine } from 'lucide-react';
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
  const onReady=useCallback((value:boolean)=>setReady(value),[]),onStatus=useCallback((value:string)=>setStatus(value),[]);
  const product=item.product;
  return <Modal label="Product preview" onClose={onClose} className="product-modal"><div className="product-detail">
    <div className="product-stage"><div className="stage-top"><span>PRODUCT PREVIEW</span><span className="model-tag">{import.meta.env.VITE_PRODUCT_API_URL?'3D MODEL':'PLACEHOLDER MODEL'}</span></div><Viewer ref={viewer} src={product.variants[0].modelSrc} name={item.name} interactive ar expectedDimensions={product.dimensions} onReady={onReady} onStatus={onStatus} onUnavailable={onUnavailable}/><div className="stage-bottom"><span>Drag to rotate. Scroll or pinch to zoom.</span><button className="icon-button" aria-label="Reset view" onClick={()=>viewer.current?.reset()}><RotateCcw size={17}/></button></div></div>
    <div className="product-panel"><div className="overline">SINGLE PRODUCT</div><h2>{item.name}</h2><a className="source-link" href={item.sourceUrl} target="_blank" rel="noreferrer">{sourceLabel(item.sourceUrl)} <ExternalLink size={12}/></a><p className="preview-disclosure">{import.meta.env.VITE_PRODUCT_API_URL?product.description:'Links currently load this same chair while product import is being built. Your original link stays attached.'}</p>
      <div className="dimension-heading"><span>Dimensions</span><div className="unit-toggle"><button aria-pressed={unit==='cm'} onClick={()=>onUnit('cm')}>cm</button><button aria-pressed={unit==='in'} onClick={()=>onUnit('in')}>in</button></div></div><div className="dimension-values">{(['width','depth','height'] as const).map(key=><div key={key}><span>{key}</span><strong>{dimension(product.dimensions[key],unit)}<small>{unit}</small></strong></div>)}</div>
      <button className="button primary" disabled={!ready} onClick={()=>viewer.current?.startAR()}><ScanLine size={18}/>{ready?'View in your room':status?'AR unavailable':'Loading model…'}<ArrowUpRight size={17}/></button><button className="button secondary" onClick={()=>setChoosing(!choosing)}><FolderPlus size={17}/>Add to a layout</button><button className="text-button save-item" onClick={onSave}>{saved?<Check size={15}/>:<Bookmark size={15}/>} {saved?'Saved to your items':'Save item'}</button>
      {choosing&&<div className="layout-picker"><span>CHOOSE A LAYOUT</span>{layouts.map(room=><button key={room.id} onClick={()=>onAdd(room.id)}>{room.name}<ArrowUpRight size={14}/></button>)}<button onClick={onNew}><Plus size={15}/>Create a new layout</button></div>}
      {status&&<p className="status-text" role="status">{status}</p>}<p className="ar-footnote">Real-world scale · iPhone & Android</p>
    </div>
  </div></Modal>;
}
