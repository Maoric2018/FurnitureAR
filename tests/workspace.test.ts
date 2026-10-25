import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { catalog, dimensionsMatch, parseProduct } from '../src/lib/products.ts';
import { arrangeModels } from '../src/lib/layout-model.ts';
import { clampPlacement, createLayout, createProductItem, duplicateLayout, duplicatePlacedItem, movePlacement, normalizeProductLink, parseWorkspace, placeItem, placeholderProduct } from '../src/lib/workspace.ts';
import { placementWarnings } from '../src/lib/room-scan.ts';

test('Snapped dragging is precise, keeps wall clearance, and can move freely',()=>{
  const room=createLayout('Room'),item={...createProductItem('example.com'),x:0,z:0,rotation:45};
  const snapped=movePlacement(item,room,.123,-.178,true);
  assert.ok(Math.abs(snapped.x-.1)<1e-9);assert.ok(Math.abs(snapped.z+.2)<1e-9);
  assert.equal(movePlacement(item,room,.123,-.178).x,.123);
  assert.equal(movePlacement(item,room,Infinity,0),item);
  assert.deepEqual(movePlacement(item,room,50,50,true),clampPlacement({...item,x:50,z:50},room));
});
test('Duplicating a placed piece preserves rotation and finish and finds nearby free space',()=>{
  let room=placeItem(createLayout('Room'),createProductItem('example.com'));
  const original={...room.items[0],rotation:45,variantId:'black'};room={...room,items:[original]};
  const next=duplicatePlacedItem(room,original),copy=next.items[1];
  assert.notEqual(copy.id,original.id);assert.equal(copy.rotation,45);assert.equal(copy.variantId,'black');
  assert.deepEqual(placementWarnings(copy,next),[]);assert.deepEqual(next.items[0],original);
});
test('Manual layouts flag overlapping pieces and oversized furniture',()=>{
  const room=placeItem(createLayout('Room'),createProductItem('example.com'));
  const copy={...room.items[0],id:'overlapping'};
  assert.ok(placementWarnings(copy,{...room,items:[...room.items,copy]}).includes('Overlaps another piece'));
  assert.ok(placementWarnings({...copy,x:0,z:0},{...room,width:1,depth:1,items:[copy]}).includes('Too large for these room dimensions'));
});

test('Any valid store URL works in the placeholder flow',()=>{
  for(const url of ['https://www.ikea.com/item','https://example.com','http://example.org/item','amazon.com/dp/123','https://www.wayfair.com/chair','https://google.com']) assert.ok(normalizeProductLink(url));
  for(const url of ['','not a link','javascript:alert(1)','file:///etc/passwd','https://user:password@example.com','not-a-link']) assert.throws(()=>normalizeProductLink(url));
  const a=createProductItem('https://example.com/a'),b=createProductItem('https://other.example/b');
  assert.notEqual(a.id,b.id);assert.equal(a.product.variants[0].modelSrc,b.product.variants[0].modelSrc);assert.notEqual(a.sourceUrl,b.sourceUrl);
});
test('Room dimensions reject nonfinite and unusable values',()=>{
  for(const value of [0,.5,NaN,Infinity,21]) assert.throws(()=>createLayout('Room','Living room',value,4));
  assert.throws(()=>createLayout('  '));
  assert.equal(createLayout('  Office  ').name,'Office');
});
test('Adding and duplicating layouts preserve independent placements and IDs',()=>{
  let room=createLayout('Study');
  const item=createProductItem('https://example.com/product');
  room=placeItem(placeItem(room,item),item);
  assert.equal(room.items.length,2);assert.notEqual(room.items[0].id,room.items[1].id);
  assert.notEqual(room.items[0].x,room.items[1].x);
  const copy=duplicateLayout(room);assert.notEqual(copy.id,room.id);
  assert.notEqual(copy.items[0].id,room.items[0].id);assert.equal(copy.items[0].x,room.items[0].x);
  copy.items[0].x=1.23;assert.notEqual(copy.items[0].x,room.items[0].x);
});
test('Room boundaries account for rotated product footprints',()=>{
  const room=createLayout('Room','Living room',3,2),item={...createProductItem('example.com'),x:100,z:100,rotation:90};
  const clamped=clampPlacement(item,room);
  assert.ok(Math.abs(clamped.x-(1.5-placeholderProduct.dimensions.depth/2))<1e-8);
  assert.ok(Math.abs(clamped.z-(1-placeholderProduct.dimensions.width/2))<1e-8);
  assert.equal(clampPlacement({...item,rotation:-15},room).rotation,345);
});
test('Saved workspace round-trips names, source links, positions and rotations',()=>{
  let room=placeItem(createLayout('Living room'),createProductItem('https://example.com/chair'));
  room.items[0]={...room.items[0],name:'Window chair',x:.4,z:.3,rotation:135};
  const workspace={layouts:[room],items:[createProductItem('https://shop.example/a')]};
  assert.deepEqual(parseWorkspace(JSON.parse(JSON.stringify(workspace))),workspace);
  assert.deepEqual(parseWorkspace(null),{layouts:[],items:[]});
  const malformed={...workspace,layouts:[{...room,width:Infinity},room]};
  assert.equal(parseWorkspace(malformed).layouts.length,1);
});
test('Combined 3D arrangement preserves floor-plan coordinates, rotation and meter dimensions',async()=>{
  const bytes=await readFile(new URL('../public/models/arc-chair-oat.glb',import.meta.url));
  const model=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const chair={...catalog[0],variants:[catalog[0].variants[1]]};
  let room=placeItem(placeItem(createLayout('Room'),createProductItem('example.com/a',chair)),createProductItem('example.com/b',chair));
  room.items[0]={...room.items[0],x:-1,z:0,rotation:0};
  room.items[1]={...room.items[1],x:1,z:0,rotation:90};
  const scene=arrangeModels(room.items,new Map([[chair.variants[0].modelSrc,model.scene]]));
  assert.equal(scene.children.length,2);assert.equal(scene.children[0].position.x,-1);assert.equal(scene.children[1].position.x,1);
  assert.equal(scene.children[1].rotation.y,-Math.PI/2);
  const box=new Box3().setFromObject(scene,true),size=box.getSize(new Vector3());
  assert.ok(Math.abs(size.x-(2+.78/2+.82/2))<.0001);
  assert.ok(Math.abs(size.y-.81)<.0001);assert.ok(Math.abs(box.min.y)<.0001);
  const usdz=await new USDZExporter().parseAsync(scene);
  assert.equal(usdz[0],0x50);assert.equal(usdz[1],0x4b);assert.ok(usdz.length>1000);
});

test('Round footprints keep the same clearance when rotated',()=>{
  const room=createLayout('Dining room','Dining room',3,3);
  const item={...createProductItem('example.com/table'),x:100,z:100,rotation:45};
  const placed=clampPlacement(item,room);
  const limit=1.5-placeholderProduct.dimensions.width/2;
  assert.ok(Math.abs(placed.x-limit)<1e-8);
  assert.ok(Math.abs(placed.z-limit)<1e-8);
  const rectangular=clampPlacement({...item,product:{...item.product,footprint:'rectangle'}},room);
  assert.ok(rectangular.x<placed.x);
  assert.throws(()=>parseProduct({...placeholderProduct,footprint:'triangle'}));
});
test('New tables start spaced apart and survive saving with their round footprint',()=>{
  let room=placeItem(createLayout('Dining room'),createProductItem('example.com/a'));
  room=placeItem(room,createProductItem('example.com/b'));
  assert.ok(room.items[1].x-room.items[0].x>placeholderProduct.dimensions.width);
  assert.equal(parseWorkspace(JSON.parse(JSON.stringify({layouts:[room],items:[]}))).layouts[0].items[0].product.footprint,'ellipse');
});
test('Supplied oak table preserves meter dimensions, floor alignment and embedded wood textures',async()=>{
  const bytes=await readFile(new URL(`../public${placeholderProduct.variants[0].modelSrc}`,import.meta.url));
  const metadata=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  assert.equal(metadata.images.length,3);
  assert.ok(metadata.images.every((image:{bufferView?:number;uri?:string})=>typeof image.bufferView==='number'&&!image.uri));
  assert.ok(metadata.materials.some((material:{pbrMetallicRoughness?:{baseColorTexture?:unknown};normalTexture?:unknown})=>material.pbrMetallicRoughness?.baseColorTexture&&material.normalTexture));
  // Geometry is decoded by the actual loader; image decoding/rendering is checked in the browser.
  const loader=new GLTFLoader().register(()=>({name:'geometry-only-test',loadTexture:async()=>null}));
  const model=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const bounds=new Box3().setFromObject(model.scene,true),size=bounds.getSize(new Vector3()),center=bounds.getCenter(new Vector3());
  assert.equal(dimensionsMatch(size,placeholderProduct.dimensions),true);
  for(const [actual,expected] of [[size.x,1.199896],[size.y,.750062],[size.z,1.199896]]) assert.ok(Math.abs(actual-expected)<.0001);
  assert.ok(Math.abs(bounds.min.y)<.0001);
  assert.ok(Math.abs(center.x)<.0001&&Math.abs(center.z)<.0001);
  const item={...createProductItem('example.com/table'),x:.4,z:-.7,rotation:45};
  const scene=arrangeModels([item],new Map([[item.product.variants[0].modelSrc,model.scene]]));
  const placed=new Box3().setFromObject(scene,true),placedCenter=placed.getCenter(new Vector3());
  assert.ok(Math.abs(placedCenter.x-.4)<.0001&&Math.abs(placedCenter.z+.7)<.0001);
  assert.ok(Math.abs(placed.min.y)<.0001);
  assert.ok(Math.abs(placed.getSize(new Vector3()).x-size.x)<.001);
});

// A scan must be an independent regular layout, not a temporary editor state.
test('scanned layouts have new identities, independent geometry, and normal persistence', async()=>{
  const {createScannedLayout,parseWorkspace}=await import('../src/lib/workspace.ts');
  const {parseRoomScan}=await import('../src/lib/room-scan.ts');
  const {readFileSync}=await import('node:fs');
  const scan=parseRoomScan(JSON.parse(readFileSync(new URL('./fixtures/room-scan.json',import.meta.url),'utf8')));
  const first=createScannedLayout(scan),second=createScannedLayout(scan);
  assert.notEqual(first.id,second.id);
  assert.equal(first.name,scan.name);
  assert.deepEqual(first.survey,scan.survey);
  first.survey!.obstacles[0].x+=.5;
  assert.notEqual(first.survey!.obstacles[0].x,second.survey!.obstacles[0].x);
  assert.deepEqual(second.survey,scan.survey);
  assert.deepEqual(parseWorkspace(JSON.parse(JSON.stringify({layouts:[first,second],items:[]}))).layouts,[first,second]);
});
