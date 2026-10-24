import { parseProduct } from './products';
import type { FurnitureProduct } from './products';

export interface ProductItem {
  id: string;
  name: string;
  sourceUrl: string;
  product: FurnitureProduct;
  createdAt: string;
}
export interface PlacedItem extends ProductItem { x: number; z: number; rotation: number }
export interface RoomLayout {
  id: string; name: string; roomType: string; width: number; depth: number;
  items: PlacedItem[]; updatedAt: string;
}
export interface Workspace { layouts: RoomLayout[]; items: ProductItem[] }
export const WORKSPACE_KEY = 'furniture-ar:workspace:v2';
export const placeholderProduct: FurnitureProduct = {
  id:'little-tree-oak-table', name:'Little Tree oak table', category:'Tables',
  tagline:'A round table. Room to gather.',
  description:'A round dining table in an oak finish with a sculptural cross pedestal.',
  dimensions:{width:1.199896,height:.750062,depth:1.199896},
  material:'Oak finish', background:'#e9dfd0', footprint:'ellipse',
  variants:[{id:'oak',name:'Oak',color:'#b68d5d',modelSrc:'/models/little-tree-oak-table.glb'}],
};
export function normalizeProductLink(value: string): string {
  const input=value.trim();
  if(!input) throw new Error('Paste a product link first.');
  let url:URL;
  try { url=new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`); }
  catch {throw new Error('Enter a valid link, like amazon.com/dp/…');}
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.') || /\s/.test(input)) throw new Error('Enter a valid http or https link.');
  return url.href;
}
export function sourceLabel(url: string) { try { return new URL(url).hostname.replace(/^www\./,''); } catch {return 'Product link';} }
export function createProductItem(url: string, product=placeholderProduct): ProductItem {
  return {id:crypto.randomUUID(),name:product.name,sourceUrl:normalizeProductLink(url),product,createdAt:new Date().toISOString()};
}
export function createLayout(name: string, roomType='Living room', width=5, depth=4): RoomLayout {
  if(!name.trim()) throw new Error('Give your layout a name.');
  if(![width,depth].every(n=>Number.isFinite(n)&&n>=1&&n<=20)) throw new Error('Room dimensions must be between 1 and 20 meters.');
  return {id:crypto.randomUUID(),name:name.trim().slice(0,80),roomType,width,depth,items:[],updatedAt:new Date().toISOString()};
}
export function clampPlacement(item: PlacedItem, room: Pick<RoomLayout,'width'|'depth'>): PlacedItem {
  const rotation=((item.rotation%360)+360)%360, radians=rotation*Math.PI/180;
  const {width,depth}=item.product.dimensions;
  const cos=Math.cos(radians),sin=Math.sin(radians),round=item.product.footprint==='ellipse';
  const extentX=(round?Math.hypot(cos*width,sin*depth):Math.abs(cos)*width+Math.abs(sin)*depth)/2;
  const extentZ=(round?Math.hypot(sin*width,cos*depth):Math.abs(sin)*width+Math.abs(cos)*depth)/2;
  const limitX=Math.max(0,room.width/2-extentX),limitZ=Math.max(0,room.depth/2-extentZ);
  return {...item,rotation,x:Math.max(-limitX,Math.min(limitX,item.x)),z:Math.max(-limitZ,Math.min(limitZ,item.z))};
}
export function placeItem(room:RoomLayout, item:ProductItem): RoomLayout {
  if(room.items.length>=30) throw new Error('This layout has 30 pieces. Start another layout to add more.');
  const index=room.items.length, spacing=Math.max(item.product.dimensions.width,item.product.dimensions.depth)+.2;
  const columns=Math.max(1,Math.floor(room.width/spacing));
  const x=(index%columns)*spacing-(Math.min(columns,3)-1)*spacing/2;
  const z=Math.floor(index/columns)*spacing-room.depth/4;
  const placed=clampPlacement({...item,id:crypto.randomUUID(),x,z,rotation:0},room);
  return {...room,items:[...room.items,placed],updatedAt:new Date().toISOString()};
}
export function duplicateLayout(layout:RoomLayout): RoomLayout {
  return {...layout,id:crypto.randomUUID(),name:`${layout.name} copy`.slice(0,80),items:layout.items.map(item=>({...item,id:crypto.randomUUID()})),updatedAt:new Date().toISOString()};
}
export function parseWorkspace(raw:unknown):Workspace {
  if(!raw||typeof raw!=='object') return {layouts:[],items:[]};
  const data=raw as Record<string,unknown>;
  const readItem=(value:unknown):ProductItem|null=>{
    try {
      const item=value as ProductItem;
      if(!item||typeof item.id!=='string'||typeof item.name!=='string'||!item.name.trim()||typeof item.createdAt!=='string')return null;
      return {...item,sourceUrl:normalizeProductLink(item.sourceUrl),product:parseProduct(item.product)};
    }catch{return null;}
  };
  const layouts:RoomLayout[]=[];
  if(Array.isArray(data.layouts)) for(const value of data.layouts){
    if(!value||typeof value.id!=='string'||typeof value.name!=='string'||!value.name.trim()||typeof value.roomType!=='string'||!Number.isFinite(Date.parse(value.updatedAt))||![value.width,value.depth].every(n=>Number.isFinite(n)&&n>=1&&n<=20)||!Array.isArray(value.items))continue;
    const items:PlacedItem[]=[];
    for(const entry of value.items.slice(0,30)){
      const item=readItem(entry);
      if(item&&[entry.x,entry.z,entry.rotation].every(Number.isFinite))items.push(clampPlacement({...item,x:entry.x,z:entry.z,rotation:entry.rotation},value));
    }
    layouts.push({...value,items});
  }
  return {layouts,items:Array.isArray(data.items)?data.items.map(readItem).filter((item):item is ProductItem=>!!item):[]};
}
export function readWorkspace():Workspace {
  try {return parseWorkspace(JSON.parse(localStorage.getItem(WORKSPACE_KEY)||'{}'));}catch{return {layouts:[],items:[]};}
}
export function saveWorkspace(workspace:Workspace):boolean {
  try{localStorage.setItem(WORKSPACE_KEY,JSON.stringify(workspace));return true;}catch{return false;}
}
export function relativeDate(value:string){
  const days=Math.floor((Date.now()-Date.parse(value))/86400000);
  return days<1?'Today':days===1?'Yesterday':`${days} days ago`;
}
