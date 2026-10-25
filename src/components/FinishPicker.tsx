import { Check } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { FurnitureVariant } from '../lib/products';
import type { AmazonListing } from '../lib/amazon';

interface Props {
  variants: FurnitureVariant[];
  selected: FurnitureVariant;
  onChange: (id: string) => void;
  compact?: boolean;
  listing?: AmazonListing;
}

export default function FinishPicker({variants,selected,onChange,compact=false,listing}:Props) {
  const fieldset=useRef<HTMLFieldSetElement>(null);
  const confirmed=variants.find(variant=>variant.id===selected.id);
  const displayed=confirmed??selected;
  const observed=listing?.colors?.status==='observed';
  const listedCount=listing?.colors?.options.length??0;
  useEffect(()=>{
    const element=fieldset.current;
    const keepControlTap=(event:Event)=>event.preventDefault();
    element?.addEventListener('beforexrselect',keepControlTap);
    return ()=>element?.removeEventListener('beforexrselect',keepControlTap);
  },[]);
  return <fieldset ref={fieldset} className={`finish-picker${compact?' finish-picker-compact':''}`} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
    <legend>{listing?'Amazon colors':'Color'}{(!listing||confirmed)&&<><strong>{displayed.name}</strong>{displayed.approximate&&<span className="color-preview-label tag">Approximate</span>}</>}</legend>
    {listing&&!confirmed&&<p className="finish-current-preview">{selected.name} is not a confirmed color for this item.</p>}
    <div className="finish-choices">{variants.map(variant=><button key={variant.id} type="button" className="finish-choice" aria-label={`Select ${variant.name} color${variant.approximate?', color preview':''}`} aria-pressed={variant.id===selected.id} onClick={()=>{if(variant.id!==selected.id)onChange(variant.id);}}>
      <span className="finish-swatch" style={{backgroundColor:variant.color}} aria-hidden="true"/>
      <span>{variant.name}</span>{variant.id===selected.id&&<Check size={13} aria-hidden="true"/>}
    </button>)}</div>
    {listing&&!compact&&<p className="finish-source-note">{!observed?'Colors unconfirmed. Reimport to check again.':!variants.length?'No matching 3D color previews.':`${listedCount>variants.length?`${variants.length} of ${listedCount} colors previewed.`:'Colors at import.'} Check stock on Amazon.`}</p>}
  </fieldset>;
}
