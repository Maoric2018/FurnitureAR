import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Armchair, Box, Check, CheckCheck, ChevronRight, Heart, Link2, LoaderCircle, Move3d, ScanLine, Search, ShieldCheck, Smartphone, Sparkles, X } from 'lucide-react';
import { catalog, categories, dimensionSummary, importProduct, validateAmazonUrl } from './lib/products';
import type { FurnitureProduct, Unit } from './lib/products';
import { readSaved, readUnit, writeSaved, writeUnit } from './lib/storage';
import { Viewer } from './components/Viewer';
import ProductDetail from './components/ProductDetail';
import Modal from './components/Modal';

export default function App() {
  const [tab,setTab]=useState<'explore'|'saved'>('explore');
  const [category,setCategory]=useState('All pieces');
  const [search,setSearch]=useState('');
  const [saved,setSaved]=useState(readSaved);
  const [unit,setUnit]=useState<Unit>(readUnit);
  const [selected,setSelected]=useState<{product:FurnitureProduct;variantId:string;demoLink?:string}|null>(null);
  const [help,setHelp]=useState<'how'|'phone'|null>(null);
  const [link,setLink]=useState(''),[linkError,setLinkError]=useState(''),[importing,setImporting]=useState(false);
  const [toast,setToast]=useState(''),[copied,setCopied]=useState(false);
  const toastTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const collection=useRef<HTMLElement>(null);
  const endpoint=import.meta.env.VITE_PRODUCT_API_URL as string | undefined;
  const notify=(message:string)=>{setToast(message);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),3500);};
  const changeUnit=(value:Unit)=>{setUnit(value);writeUnit(value);};
  const isSaved=(id:string,variantId:string)=>saved.some(item=>item.product.id===id&&item.variantId===variantId);
  const toggleSaved=(product:FurnitureProduct,variantId:string)=>{
    const exists=isSaved(product.id,variantId);
    const next=exists?saved.filter(item=>!(item.product.id===product.id&&item.variantId===variantId)):[...saved,{product,variantId}];
    setSaved(next);
    notify(writeSaved(next)?(exists?'Piece removed from your collection.':'A little inspiration, saved.'):'Saved for this visit. Your browser couldn’t store it permanently.');
  };
  const openProduct=(product:FurnitureProduct,variantId=product.variants[0].id)=>setSelected({product,variantId});
  const explore=()=>{setTab('explore');setCategory('All pieces');setSearch('');requestAnimationFrame(()=>collection.current?.scrollIntoView({behavior:'smooth',block:'start'}));};
  const handleImport=async(event:FormEvent)=>{
    event.preventDefault();setLinkError('');
    let url:string;try{url=validateAmazonUrl(link);}catch(error){setLinkError((error as Error).message);return;}
    if(!endpoint){setSelected({product:catalog[0],variantId:catalog[0].variants[0].id,demoLink:url});return;}
    setImporting(true);
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);
    try{const product=await importProduct(url,endpoint,controller.signal);setSelected({product,variantId:product.variants[0].id});}
    catch(error){setLinkError((error as Error).name==='AbortError'?'The importer took too long. Please try again.':(error as Error).message);}
    finally{clearTimeout(timeout);setImporting(false);}
  };
  const pieces=tab==='saved'?saved:catalog.map(product=>({product,variantId:product.variants[0].id}));
  const filtered=pieces.filter(({product})=>(category==='All pieces'||category===product.category)&&`${product.name} ${product.category} ${product.material}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <a className="skip-link" href="#collection">Skip to furniture</a>
    <header className="site-header"><a className="brand" href="#" onClick={()=>{setTab('explore');window.scrollTo({top:0,behavior:'smooth'});}} aria-label="Furniture AR home"><span className="brand-mark"><Armchair size={24}/></span><span>furniture<span className="brand-ar">AR</span><span className="brand-period">.</span></span></a>
      <nav aria-label="Main navigation"><button className={tab==='explore'?'nav-link active':'nav-link'} onClick={explore}>Explore</button><button className={tab==='saved'?'nav-link active':'nav-link'} onClick={()=>{setTab('saved');setCategory('All pieces');setSearch('');requestAnimationFrame(()=>collection.current?.scrollIntoView({behavior:'smooth'}));}}>Saved pieces{saved.length>0&&<span className="nav-count">{saved.length}</span>}</button><button className="nav-link how-link" onClick={()=>setHelp('how')}>How it works <ArrowUpRight size={13}/></button></nav>
      <button className="header-phone" onClick={()=>setHelp('phone')}><Smartphone size={16}/><span>Made for your space</span></button>
    </header>
    <main>
      <section className="hero" aria-labelledby="hero-heading">
        <div className="hero-copy"><div className="eyebrow"><span className="small-line"/> A NEW PERSPECTIVE ON YOUR SPACE</div><h1 id="hero-heading">Make room<br/>for <em>possibility.</em></h1><p>That perfect piece. In your actual room.<br className="desktop-break"/> See how furniture looks and fits before you commit.</p><button className="button primary hero-cta" onClick={explore}>Find your next piece <ArrowRight size={17}/></button><div className="hero-proof"><span><ScanLine size={16}/> True-to-life scale</span><span className="proof-divider"/><span><Box size={16}/> No app download</span></div></div>
        <div className="hero-scene"><div className="scene-topline"><span className="live-label"><span className="pulse-dot"/> YOUR SPACE, REIMAGINED</span><span className="scene-number">01 / 06</span></div><span className="scene-arch"/><div className="scene-floor"/>
          <Viewer src={catalog[0].variants[0].modelSrc} name="The Arc Chair in sage" interactive autoRotate/>
          <span className="dimension-tag"><span className="measure-tick"/> 78 cm <span className="measure-tick"/></span>
          <div className="scene-note"><span className="note-dot"/><span>Looks like it belongs.<br/><strong>Know that it fits.</strong></span></div>
          <button className="featured-piece" onClick={()=>openProduct(catalog[0])}><span className="featured-icon"><Armchair size={22}/></span><span><small>MEET YOUR NEW FAVORITE</small><strong>The Arc Chair <span>in Sage</span></strong></span><span className="round-arrow"><ArrowUpRight size={19}/></span></button>
        </div>
      </section>
      <section className="link-section" aria-labelledby="link-heading"><div className="link-copy"><span className="link-icon"><Link2 size={21}/></span><div><h2 id="link-heading">Already have something in mind?</h2><p>Bring an Amazon find into your space.</p></div></div><form onSubmit={handleImport} noValidate><label className="sr-only" htmlFor="amazon-link">Amazon product link</label><div className={`link-input-group ${linkError?'invalid':''}`}><Link2 size={17}/><input id="amazon-link" type="url" placeholder="Paste an Amazon product link…" value={link} onChange={event=>{setLink(event.target.value);setLinkError('');}} aria-invalid={!!linkError} aria-describedby={linkError?'link-error':'import-note'} autoComplete="off" disabled={importing}/><button type="submit" disabled={importing} aria-label={endpoint?'Import product':'Preview a sample with this link'}>{importing?<LoaderCircle className="spin" size={18}/>:<><span>{endpoint?'Preview':'Try demo'}</span><ArrowRight size={17}/></>}</button></div><p id="import-note" className="import-footnote">{endpoint?'Your piece, one link away.':<><span className="demo-dot"/> Demo mode · Amazon import is coming soon</>}</p>{linkError&&<p id="link-error" className="form-error" role="alert">{linkError}</p>}</form></section>
      <section id="collection" className="collection" ref={collection} aria-labelledby="collection-heading"><div className="collection-heading"><div><span className="eyebrow">{tab==='saved'?'YOUR PERSONAL SHORTLIST':'A LITTLE INSPIRATION'}</span><h2 id="collection-heading">{tab==='saved'?'Pieces you love.':'Good design. Meet your room.'}</h2></div><span className="collection-subtitle">{tab==='saved'?'Saved on this device, ready when you are.':'Explore our collection of ready-to-place samples.'}</span></div>
        <div className="collection-toolbar"><div className="category-list" aria-label="Filter furniture">{['All pieces',...categories].map(item=><button key={item} className={category===item?'selected':''} aria-pressed={category===item} onClick={()=>setCategory(item)}>{item==='All pieces'&&<span className="category-grid">▦</span>}{item}</button>)}</div><label className="search-field"><Search size={16}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Find a piece" aria-label="Search furniture"/>{search&&<button onClick={()=>setSearch('')} aria-label="Clear search"><X size={14}/></button>}</label></div>
        <div className="product-grid">{filtered.map(({product,variantId},index)=>{const variant=product.variants.find(v=>v.id===variantId)||product.variants[0];return <article className="product-card" key={`${product.id}-${variantId}`} style={{'--card-bg':product.background,'--card-order':index} as React.CSSProperties}>
          <div className="product-image"><button className="product-open" aria-label={`Preview ${product.name} in 3D`} onClick={()=>openProduct(product,variant.id)}><Viewer src={variant.modelSrc} name={`${product.name} in ${variant.name}`}/><span className="preview-label"><Move3d size={14}/> Explore in 3D <ArrowUpRight size={14}/></span></button><span className="sample-pill">3D SAMPLE</span><button className={`favorite-button ${isSaved(product.id,variant.id)?'saved':''}`} aria-label={`${isSaved(product.id,variant.id)?'Unsave':'Save'} ${product.name}`} aria-pressed={isSaved(product.id,variant.id)} onClick={()=>toggleSaved(product,variant.id)}><Heart size={17} fill={isSaved(product.id,variant.id)?'currentColor':'none'}/></button></div>
          <div className="product-info"><div><span className="product-category">{product.category}</span><button className="product-title" onClick={()=>openProduct(product,variant.id)}>{product.name}</button><p>{dimensionSummary(product,unit)} <span>W × D × H</span></p></div><div className="card-swatches" aria-label="Available finishes">{product.variants.map(v=><button key={v.id} aria-label={`Preview ${product.name} in ${v.name}`} title={v.name} style={{background:v.color}} onClick={()=>openProduct(product,v.id)}/>)}</div></div>
        </article>;})}</div>
        {filtered.length===0&&<div className="empty-state">{tab==='saved'?<Heart size={36}/>:<Search size={36}/>}<h3>{tab==='saved'&&!saved.length?'Your collection starts here.':'No pieces found.'}</h3><p>{tab==='saved'&&!saved.length?'Tap the heart on a piece you love. We’ll keep it here for you.':'Try a different search or explore another category.'}</p><button className="button secondary" onClick={explore}>Explore the collection <ArrowRight size={16}/></button></div>}
        <div className="collection-footer"><span><ShieldCheck size={14}/> Every sample is modeled to the dimensions shown.</span><div className="unit-toggle" aria-label="Collection measurement units"><button aria-pressed={unit==='cm'} onClick={()=>changeUnit('cm')}>cm</button><button aria-pressed={unit==='in'} onClick={()=>changeUnit('in')}>in</button></div></div>
      </section>
      <section className="how-strip"><div className="how-intro"><span className="eyebrow">LESS GUESSWORK. MORE YOU.</span><h2>A better fit.<br/>In three little steps.</h2><button className="text-button" onClick={()=>setHelp('how')}>A quick look at how <ArrowUpRight size={15}/></button></div><div className="how-step"><span>01</span><Box size={24}/><h3>Find your piece</h3><p>Explore the samples, or bring a link when Amazon import is ready.</p></div><div className="how-step"><span>02</span><ScanLine size={24}/><h3>Make some room</h3><p>Open AR on your phone and slowly scan a well-lit floor.</p></div><div className="how-step"><span>03</span><Armchair size={24}/><h3>See the possibility</h3><p>Place, move, and rotate. Get a feel for it at its actual size.</p></div></section>
    </main>
    <footer className="site-footer"><a href="#" className="footer-brand">furniture<span>AR.</span></a><p>A little less imagining. A little more knowing.</p><span>Made for the way you live <Sparkles size={13}/></span></footer>
    {selected&&<ProductDetail key={`${selected.product.id}-${selected.variantId}-${selected.demoLink||''}`} {...selected} initialVariant={selected.variantId} unit={unit} onUnit={changeUnit} saved={isSaved} onSave={toggleSaved} onClose={()=>setSelected(null)} onUnavailable={()=>setHelp('phone')}/>}
    {help&&<Modal label={help==='how'?'How Furniture AR works':'Open on your phone'} onClose={()=>{setHelp(null);setCopied(false);}} className="help-modal"><div className="help-content"><span className="help-icon">{help==='phone'?<Smartphone size={30}/>:<ScanLine size={30}/>}</span><span className="eyebrow">A NEW WAY TO SEE YOUR SPACE</span><h2>{help==='phone'?'Your room is the showroom.':'From your screen to your space.'}</h2><p>{help==='phone'?'To place furniture in your room, open this page in Safari on an iPhone or Chrome on an AR-capable Android phone.':'Choose a piece, pick a finish, and tap “View in your room” on your phone.'}</p><ol className="help-steps"><li><span>1</span><div><strong>Find a little floor space</strong><p>Use a well-lit room. Move your phone slowly so it can detect the floor.</p></div></li><li><span>2</span><div><strong>Place it. Make it yours.</strong><p>Drag to reposition and use two fingers to rotate. Each piece stays at its modeled size.</p></div></li><li><span>3</span><div><strong>Take a good look around</strong><p>Walk around to check the fit. AR is a visual guide; use a tape measure before buying.</p></div></li></ol><div className="compatibility-note"><ShieldCheck size={18}/><p>Requires a compatible phone and a secure HTTPS link. Allow camera access if asked. Android may need Google Play Services for AR. Desktop supports 3D preview.</p></div><button className="button primary" onClick={async()=>{try{await navigator.clipboard.writeText(window.location.href);setCopied(true);}catch{notify('Copy the address from your browser’s address bar.');}}}>{copied?<CheckCheck size={18}/>:<Link2 size={18}/>} {copied?'Link copied':'Copy link for your phone'}</button><button className="text-button help-dismiss" onClick={()=>setHelp(null)}>Got it <Check size={15}/></button></div></Modal>}
    {toast&&<div className="toast" role="status"><Check size={16}/>{toast}<button onClick={()=>setToast('')} aria-label="Dismiss notification"><X size={14}/></button></div>}
    <button className="mobile-explore" onClick={explore} aria-label="Browse furniture"><ArrowDown size={16}/> Explore the pieces <ChevronRight size={16}/></button>
  </>;
}
