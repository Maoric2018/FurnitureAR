import { useState } from 'react';
import { ArrowUpRight, Link2, LoaderCircle } from 'lucide-react';
import { importProduct } from '../lib/products';
import { createProductItem, normalizeProductLink } from '../lib/workspace';
import type { ProductItem } from '../lib/workspace';
export default function LinkInput({onProduct,buttonLabel='Preview product',compact=false}:{onProduct:(item:ProductItem)=>void;buttonLabel?:string;compact?:boolean}){
  const [link,setLink]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  return <form className={`product-link-form ${compact?'compact':''}`} onSubmit={async event=>{
    event.preventDefault();setError('');
    try{
      const url=normalizeProductLink(link),endpoint=import.meta.env.VITE_PRODUCT_API_URL;
      if(!endpoint){onProduct(createProductItem(url));setLink('');return;}
      setBusy(true);const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);
      try{onProduct(createProductItem(url,await importProduct(url,endpoint,controller.signal)));setLink('');}finally{clearTimeout(timeout);}
    }catch(error){setError((error as Error).name==='AbortError'?'That took too long. Please try again.':(error as Error).message);}finally{setBusy(false);}
  }} noValidate>
    <div className={`product-link-field ${error?'invalid':''}`}><Link2 size={17}/><input type="url" aria-label="Product link" placeholder="Paste a product link" value={link} onChange={event=>{setLink(event.target.value);setError('');}} disabled={busy} aria-invalid={!!error}/>{compact&&<button aria-label={buttonLabel} disabled={busy} type="submit">{busy?<LoaderCircle size={17} className="spin"/>:<ArrowUpRight size={18}/>}</button>}</div>
    {!compact&&<button type="submit" className="button primary" disabled={busy}>{busy?'Loading product…':buttonLabel}{busy?<LoaderCircle size={17} className="spin"/>:<ArrowUpRight size={17}/>}</button>}
    {error&&<p className="form-error" role="alert">{error}</p>}
  </form>;
}
