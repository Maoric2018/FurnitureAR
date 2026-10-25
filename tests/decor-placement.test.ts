import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Box3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import FloorPlan from '../src/components/FloorPlan.tsx';
import { catalog, parseProduct } from '../src/lib/products.ts';
import type { FurnitureProduct } from '../src/lib/products.ts';
import { clampPlacement, createLayout, createProductItem, parseWorkspace, placementElevationLimit } from '../src/lib/workspace.ts';
import type { PlacedItem, RoomLayout } from '../src/lib/workspace.ts';
import { placementWarnings } from '../src/lib/room-scan.ts';
import { exportLayout, exportNativeLayout } from '../src/lib/layout-model.ts';

function product(kind?:FurnitureProduct['placementKind']):FurnitureProduct {
  return {...catalog[0],id:kind??'floor',name:kind??'Floor piece',category:kind?'Decor':'Seating',
    dimensions:{width:.8,depth:.04,height:.6},footprint:'rectangle',placementKind:kind};
}
function piece(kind?:FurnitureProduct['placementKind'],extra:Partial<PlacedItem>={}):PlacedItem {
  return {...createProductItem('https://www.amazon.com/dp/B0C4DGFFCM',product(kind)),x:0,z:0,rotation:0,...extra};
}
function room():RoomLayout {
  return {...createLayout('Decor checks','Bedroom',4,4),survey:{source:'apple-roomplan',capturedAt:'2026-01-01T00:00:00Z',
    walls:[{id:'left',start:{x:-2,z:-2},end:{x:-2,z:2},height:2.7,confidence:'high'},
      {id:'right',start:{x:2,z:2},end:{x:2,z:-2},height:2.7,confidence:'high'}],
    openings:[],obstacles:[{id:'desk',name:'Desk',category:'table',x:0,z:0,width:1.2,depth:.7,height:.75,rotation:0,confidence:'high'}]}};
}

test('decor metadata and mounting elevation survive storage, while invalid fields are rejected',()=>{
  const art=piece('wall',{elevation:1.25}),layout={...room(),items:[art]};
  const restored=parseWorkspace(JSON.parse(JSON.stringify({layouts:[layout],items:[]}))).layouts[0];
  assert.equal(restored.items[0].elevation,1.25);
  assert.equal(restored.items[0].product.placementKind,'wall');
  assert.equal(restored.items[0].product.category,'Decor');
  for(const elevation of ['1',NaN,Infinity,-.1,12.1]){
    assert.equal(parseWorkspace({layouts:[{...layout,items:[{...art,elevation}]}]}).layouts[0].items.length,0);
  }
  assert.throws(()=>parseProduct({...art.product,placementKind:'ceiling'}));
  assert.equal(clampPlacement({...art,elevation:100},layout).elevation,placementElevationLimit(art.product,layout));
  assert.equal(clampPlacement(piece('rug',{elevation:2}),layout).elevation,0);
  assert.equal(clampPlacement(piece(),layout).elevation,undefined,'Legacy placements keep their ground-based representation');
  const withCorruptRoom=parseWorkspace({layouts:[{...layout,id:'bad',survey:{walls:null}},layout]});
  assert.equal(withCorruptRoom.layouts.length,1,'A malformed survey cannot discard the other saved rooms');
  assert.equal(withCorruptRoom.layouts[0].id,layout.id);
});

test('rugs can overlap furnishings but retain room-boundary and doorway checks',()=>{
  const rug=piece('rug',{product:{...product('rug'),dimensions:{width:1.2,depth:1.8,height:.01}}});
  const chair=piece(undefined,{product:{...product(),dimensions:{width:.6,depth:.6,height:1}}});
  const layout={...room(),items:[chair,rug]};
  assert.deepEqual(placementWarnings(rug,layout),[]);
  assert.equal(placementWarnings(chair,{...layout,survey:{...layout.survey!,obstacles:[]}}).includes('Overlaps another piece'),false);
  assert.ok(placementWarnings({...rug,x:2},layout).includes('Too large for these room dimensions'));
  const doorway={id:'door',start:{x:-.5,z:0},end:{x:.5,z:0},height:2.1,confidence:'high' as const,kind:'door' as const};
  assert.ok(placementWarnings(rug,{...layout,survey:{...layout.survey!,openings:[doorway]}}).includes('Near a doorway — check access'));
});

test('raised artwork clears a desk and lower furniture but detects actual vertical collisions',()=>{
  const art=piece('wall',{elevation:1.2}),layout=room();
  assert.deepEqual(placementWarnings(art,layout),[]);
  assert.ok(placementWarnings({...art,elevation:.5},layout).includes('Overlaps an existing object'));
  const lowPiece=piece(undefined,{product:{...product(),dimensions:{width:.8,depth:.5,height:.8}}});
  assert.deepEqual(placementWarnings(art,{...layout,items:[lowPiece,art]}),[]);
  assert.ok(placementWarnings({...art,elevation:.5},{...layout,items:[lowPiece]}).includes('Overlaps another piece'));
  assert.ok(placementWarnings({...art,elevation:2.4},layout).includes('Above the scanned ceiling'));
});

test('wall artwork may sit against the measured surface but cannot straddle a wall or cover a doorway',()=>{
  const layout=room(),art=piece('wall',{x:-1.98,elevation:1.2,rotation:270});
  assert.deepEqual(placementWarnings(art,layout),[],'Frame back touches the actual wall while its front stays inside');
  assert.ok(placementWarnings({...art,x:-2},layout).includes('Crosses a scanned wall'));
  const doorway={id:'door',start:{x:-2,z:-.5},end:{x:-2,z:.5},height:2.1,confidence:'high' as const,kind:'door' as const};
  assert.ok(placementWarnings(art,{...layout,survey:{...layout.survey!,openings:[doorway]}}).includes('Near a doorway — check access'));
});

test('floor plan draws rugs underneath scanned furniture and preserves artwork selection and elevation',()=>{
  const art=piece('wall',{id:'art',elevation:1.2}),rug=piece('rug',{id:'rug'});
  const html=renderToStaticMarkup(createElement(FloorPlan,{layout:{...room(),items:[art,rug]},onSelect(){}}));
  assert.ok(html.indexOf('data-piece-id="rug"')<html.indexOf('data-outline-id="desk"'));
  assert.ok(html.indexOf('data-outline-id="desk"')<html.indexOf('data-piece-id="art"'));
  assert.match(html,/data-piece-id="art"[^>]*data-elevation="1.200"/);
  assert.ok(html.includes('1.20 metres above floor'));
});

test('real GLB and native USDZ exports retain model-bottom elevation and floor-plan orientation',async()=>{
  const originalFetch=globalThis.fetch,originalWindow=globalThis.window,originalReader=globalThis.FileReader;
  const data=readFileSync(new URL('../public/models/arc-chair-oat.glb',import.meta.url));
  class BlobReader {result:ArrayBuffer|null=null;onloadend:(()=>void)|null=null;readAsArrayBuffer(blob:Blob){void blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();});}}
  let objectURL:string|undefined;
  try{
    (globalThis as any).window={location:{href:'https://roomify.test/'}};
    globalThis.FileReader=BlobReader as unknown as typeof FileReader;
    globalThis.fetch=async(input,init)=>String(input).startsWith('blob:')?originalFetch(input,init):new Response(data);
    const reference={...catalog[0],variants:[catalog[0].variants[1]]};
    const art={...createProductItem('https://www.amazon.com/dp/B0C4DGFFCM',reference),name:'Raised reference',x:.7,z:-.5,rotation:270,elevation:1.2};
    const floor={...art,id:'floor',name:'Floor reference',x:-.7,elevation:0};
    const layout={...room(),items:[art,floor]};
    const exported=await exportLayout(layout);objectURL=exported.url;
    const glb=await originalFetch(objectURL).then(response=>response.arrayBuffer());
    const model=await new GLTFLoader().parseAsync(glb,'');
    const raised=model.scene.getObjectByName('Raised_reference')??model.scene.getObjectByName('Raised reference');
    assert.ok(raised,'The raised model exists in the exported GLB');
    assert.ok(Math.abs(new Box3().setFromObject(raised,true).min.y-1.2)<.0001);
    assert.ok(Math.abs(new Box3().setFromObject(model.scene,true).min.y)<.0001);
    assert.ok(Math.abs(exported.dimensions.height-(1.2+reference.dimensions.height))<.0001);
    const files=unzipSync(await exportNativeLayout(layout));
    const stage=new TextDecoder().decode(files['model.usda']);
    assert.ok(stage.includes('0.7, 1.2, -0.5, 1'),'Native AR must keep the mounted item at the saved elevation');
    assert.equal(stage.includes('preliminary:anchoring:type'),false);
    assert.ok(stage.includes('</Root/Scenes/Scene/Materials/'),'Native scene retains its connected materials');
  }finally{
    if(objectURL)URL.revokeObjectURL(objectURL);
    globalThis.fetch=originalFetch;(globalThis as any).window=originalWindow;globalThis.FileReader=originalReader;
  }
});
