import { useState } from 'react';
import { ArrowUpRight, Link2, LoaderCircle } from 'lucide-react';
import { ImportError, importAmazonProduct } from '../lib/amazon';
import { createImportedItem } from '../lib/workspace';
import type { ProductItem } from '../lib/workspace';
export default function LinkInput({onProduct,buttonLabel='Preview product',compact=false}:{onProduct:(item:ProductItem)=>void;buttonLabel?:string;compact?:boolean}){
  const [link,setLink]=useState(()=>{try{return sessionStorage.getItem('furniture-ar:pending-link')||'';}catch{return '';}}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[needsSignIn,setNeedsSignIn]=useState(false);
  return <form className={`product-link-form ${compact?'compact':''}`} onSubmit={async event=>{
    event.preventDefault();setError('');setNeedsSignIn(false);
    try{
      const url=link.trim();if(!url)throw new Error('Paste an Amazon product link first.');
      setBusy(true);const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),65000);
      try{const result=await importAmazonProduct(url,controller.signal);onProduct(createImportedItem(result.listing,result.product));setLink('');try{sessionStorage.removeItem('furniture-ar:pending-link');}catch{}}finally{clearTimeout(timeout);}
    }catch(error){setNeedsSignIn(error instanceof ImportError&&error.code==='SIGN_IN_REQUIRED');setError((error as Error).name==='AbortError'?'Amazon is taking longer than expected. Try again shortly.':(error as Error).message);}finally{setBusy(false);}
  }} noValidate>
    <div className={`product-link-field ${error?'invalid':''}`}><Link2 size={17}/><input type="url" aria-label="Product link" placeholder="Paste an Amazon.com link" value={link} onChange={event=>{setLink(event.target.value);setError('');setNeedsSignIn(false);}} disabled={busy} aria-invalid={!!error}/>{compact&&<button aria-label={buttonLabel} disabled={busy} type="submit">{busy?<LoaderCircle size={17} className="spin"/>:<ArrowUpRight size={18}/>}</button>}</div>
    {!compact&&<button type="submit" className="button primary" disabled={busy}>{busy?'Loading product…':buttonLabel}{busy?<LoaderCircle size={17} className="spin"/>:<ArrowUpRight size={17}/>}</button>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {needsSignIn&&<a className="text-button" href="/signin-with-chatgpt?return_to=%2F" target="_top" onClick={()=>{try{sessionStorage.setItem('furniture-ar:pending-link',link);}catch{}}}>Sign in to continue <ArrowUpRight size={15}/></a>}
  </form>;
}
