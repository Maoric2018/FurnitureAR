import scanData from '../data/urban-demo-room.json';
import type { FurnitureProduct } from './products';
import { createProductItem, createScannedLayout } from './workspace';
import type { PlacedItem, RoomLayout } from './workspace';
import { parseRoomScan } from './room-scan';
import type { DesignProposal } from './design';

export const URBAN_DEMO_NAME='Urban High-Rise · Gallery Retreat';
export const URBAN_DEMO_OPTIONS=[
  {id:'gallery',name:'Gallery Retreat',description:'A wide graphic rug anchors the room, with warm light beside the bed and an abstract gallery on the left wall.'},
  {id:'studio',name:'Skyline Studio',description:'A lengthwise rug defines the workspace, with the gallery above the desk and a lamp in the lower-right corner.'},
  {id:'lounge',name:'Evening Lounge',description:'A central rug and bedside light open up the middle, while the three prints form a gallery along the lower wall.'},
] as const;
export type UrbanDemoOptionId=typeof URBAN_DEMO_OPTIONS[number]['id'];
export const URBAN_DEMO_ROOM_ID='roomify-urban-scan-demo-v1';
export const URBAN_DEMO_READY_ID='roomify-urban-furnished-demo-v1';
export const isUrbanDemoLayout=(layout:RoomLayout)=>layout.roomType==='Urban high-rise';
export const URBAN_DEMO_PRODUCTS=[
  {name:'KAIRNE abstract framed canvas · set of 3',asin:'B0D7MGQ5H6',url:'https://www.amazon.com/dp/B0D7MGQ5H6',detail:'Three 16 × 24 in panels · neutral black / brown',image:'/models/urban-demo/kairne-abstract-1.svg'},
  {name:'JONATHAN Y Khalil rug',asin:'B081D81DBX',url:'https://www.amazon.com/dp/B081D81DBX',detail:'4 × 6 ft · cream / black',image:'/models/urban-demo/jonathan-y-khalil-rug.svg'},
  {name:'Ambimall floor lamp',asin:'B0C4DGFFCM',url:'https://www.amazon.com/dp/B0C4DGFFCM',detail:'Black stem · beige linen shade',image:'/models/urban-demo/ambimall-floor-lamp.svg'},
] as const;

function product(id:string,name:string,dimensions:FurnitureProduct['dimensions'],placementKind:FurnitureProduct['placementKind'],file:string,asin:string,color:string,material:string):FurnitureProduct {
  return {id,name,category:placementKind==='floor'?'Lighting':'Decor',tagline:'Urban High-Rise selection',
    description:'Product-inspired 3D approximation. Confirm measurements and availability on the Amazon listing.',
    dimensions,placementKind,material,background:'#e9e4db',scaleReference:'height',
    variants:[{id:'listed-finish',name:placementKind==='floor'?'Black / beige':placementKind==='rug'?'Cream / black':'Neutral black / brown',color,
      modelSrc:`/models/urban-demo/${file}.glb`,approximate:true,asin,productUrl:`https://www.amazon.com/dp/${asin}`}]};
}
export const urbanDemoModels={
  rug:product('urban-khalil-rug','JONATHAN Y Khalil · 4 × 6 rug',{width:1.2192,depth:1.8288,height:.009906},'rug','jonathan-y-khalil-rug','B081D81DBX','#e4ddcf','Polypropylene · cream / black'),
  lamp:product('urban-ambimall-lamp','Ambimall · modern floor lamp',{width:.5,depth:.2794,height:1.56972},'floor','ambimall-floor-lamp','B0C4DGFFCM','#d8cbb4','Black metal / beige linen; arm reach estimated'),
  art:[1,2,3].map(index=>product(`urban-kairne-${index}`,`KAIRNE · abstract panel ${index} of 3`,{width:.4064,depth:.025,height:.6096},'wall',`kairne-abstract-${index}`,'B0D7MGQ5H6','#d8c8ae','Framed canvas; frame depth estimated')),
};
export function createUrbanDemoRoom():RoomLayout {
  const room=createScannedLayout(parseRoomScan(scanData));
  return {...room,id:URBAN_DEMO_ROOM_ID,name:'Urban High-Rise · Scanned room',roomType:'Scanned room'};
}
function placed(product:FurnitureProduct,x:number,z:number,rotation:number,elevation=0):PlacedItem {
  return {...createProductItem(product.variants[0].productUrl!,product),x,z,rotation,elevation};
}
type DemoPlacement=readonly [x:number,z:number,rotation:number,elevation?:number];
// Rugs may sit beneath furniture; solid pieces and all doorway clearances stay clear.
// Art faces local +Z: 270° points inward from the left wall, 90° from the right, 180° from below.
const optionPlacements:Record<UrbanDemoOptionId,readonly DemoPlacement[]>={
  gallery:[[-.05,.55,90],[.86,-.03,0],[-1.67,-.42,270,1.3],[-1.67,.08,270,1.3],[-1.67,.58,270,1.3]],
  studio:[[.92,.6,0],[.8,1.61,180],[1.67,.05,90,1.3],[1.67,.55,90,1.3],[1.67,1.05,90,1.3]],
  lounge:[[-.2,.5,90],[.15,.05,90],[.5,1.77,180,1.3],[.98,1.77,180,1.3],[1.46,1.77,180,1.3]],
};
export function createUrbanDemoProposal(optionId:UrbanDemoOptionId='gallery'):DesignProposal {
  const option=URBAN_DEMO_OPTIONS.find(option=>option.id===optionId)??URBAN_DEMO_OPTIONS[0];
  const name=`Urban High-Rise · ${option.name}`;
  const base=createUrbanDemoRoom();
  const models=[urbanDemoModels.rug,urbanDemoModels.lamp,...urbanDemoModels.art];
  const items=models.map((product,index)=>placed(product,...optionPlacements[option.id][index]));
  const layout={...base,id:crypto.randomUUID(),name,roomType:'Urban high-rise',items,updatedAt:new Date().toISOString()};
  return {id:crypto.randomUUID(),name,description:option.description,
    layout,added:5,total:0,currency:'USD',pricingAvailable:false,notes:['Five pieces from three Amazon listings; the artwork is sold as one set of three.','Check current prices and stock on Amazon. 3D models are visual approximations.'],
    draft:{name,description:'Urban high-rise arrangement',items:items.map(item=>({candidateId:item.product.id,x:item.x,z:item.z,rotation:item.rotation}))}};
}
export function createUrbanDemoProposals():DesignProposal[] {
  return URBAN_DEMO_OPTIONS.map(option=>createUrbanDemoProposal(option.id));
}
