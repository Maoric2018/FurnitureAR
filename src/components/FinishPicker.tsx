import { Check } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { FurnitureVariant } from '../lib/products';

interface Props {
  variants: FurnitureVariant[];
  selected: FurnitureVariant;
  onChange: (id: string) => void;
  compact?: boolean;
}

export default function FinishPicker({variants,selected,onChange,compact=false}:Props) {
  const fieldset=useRef<HTMLFieldSetElement>(null);
  useEffect(()=>{
    const element=fieldset.current;
    const keepControlTap=(event:Event)=>event.preventDefault();
    element?.addEventListener('beforexrselect',keepControlTap);
    return ()=>element?.removeEventListener('beforexrselect',keepControlTap);
  },[]);
  return <fieldset ref={fieldset} className={`finish-picker${compact?' finish-picker-compact':''}`} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
    <legend>Color <strong>{selected.name}</strong>{selected.approximate&&<span className="color-preview-label">Color preview</span>}</legend>
    <div className="finish-choices">{variants.map(variant=><button key={variant.id} type="button" className="finish-choice" aria-label={`Select ${variant.name} color${variant.approximate?', color preview':''}`} aria-pressed={variant.id===selected.id} onClick={()=>{if(variant.id!==selected.id)onChange(variant.id);}}>
      <span className="finish-swatch" style={{backgroundColor:variant.color}} aria-hidden="true"/>
      <span>{variant.name}</span>{variant.id===selected.id&&<Check size={13} aria-hidden="true"/>}
    </button>)}</div>
  </fieldset>;
}
