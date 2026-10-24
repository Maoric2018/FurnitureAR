import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { arrangeModels } from '../src/lib/layout-model.ts';
import { clampPlacement, createLayout, createProductItem, duplicateLayout, normalizeProductLink, parseWorkspace, placeItem, placeholderProduct } from '../src/lib/workspace.ts';

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
  let room=placeItem(placeItem(createLayout('Room'),createProductItem('example.com/a')),createProductItem('example.com/b'));
  room.items[0]={...room.items[0],x:-1,z:0,rotation:0};
  room.items[1]={...room.items[1],x:1,z:0,rotation:90};
  const scene=arrangeModels(room.items,new Map([[placeholderProduct.variants[0].modelSrc,model.scene]]));
  assert.equal(scene.children.length,2);assert.equal(scene.children[0].position.x,-1);assert.equal(scene.children[1].position.x,1);
  assert.equal(scene.children[1].rotation.y,-Math.PI/2);
  const box=new Box3().setFromObject(scene,true),size=box.getSize(new Vector3());
  assert.ok(Math.abs(size.x-(2+.78/2+.82/2))<.0001);
  assert.ok(Math.abs(size.y-.81)<.0001);assert.ok(Math.abs(box.min.y)<.0001);
  const usdz=await new USDZExporter().parseAsync(scene);
  assert.equal(usdz[0],0x50);assert.equal(usdz[1],0x4b);assert.ok(usdz.length>1000);
});
