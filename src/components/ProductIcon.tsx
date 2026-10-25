import { Armchair, Lamp, Archive, Frame } from 'lucide-react';
import type { Category } from '../lib/products';

export default function ProductIcon({category,size=24}:{category:Category;size?:number}) {
  if(category==='Tables') return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><ellipse cx="12" cy="7" rx="9" ry="3.5"/><path d="M3 7v2c0 2 4 3.5 9 3.5S21 11 21 9V7M10 12v6l-4 2m8-8v6l4 2m-6-7v7"/></svg>;
  const Icon=category==='Lighting'?Lamp:category==='Storage'?Archive:category==='Decor'?Frame:Armchair;
  return <Icon size={size} aria-hidden="true"/>;
}
