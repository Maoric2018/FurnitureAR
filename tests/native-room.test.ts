import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalog } from '../src/lib/products.ts';
import { createLayout, createProductItem, duplicateLayout, parseWorkspace, placeItem } from '../src/lib/workspace.ts';
import { parseRoomScan, parseSurvey } from '../src/lib/room-scan.ts';
import { bytesToBase64, hasNativeRoomAR, nativeLayoutMetadata, nativeRequest } from '../src/lib/native-room.ts';
import { exportNativeLayout } from '../src/lib/layout-model.ts';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/room-scan.json',import.meta.url),'utf8'));
const scanId='0fd3d6b7-9107-4310-9cec-f9f3d470692e';
function scannedRoom(){const scan=parseRoomScan({...fixture,scanId});return {...createLayout('Room','Scanned room',scan.width,scan.depth),survey:scan.survey};}

test('native scan identity survives recentering, storage, and independent layout copies',()=>{
  const room=scannedRoom();assert.equal(room.survey.scanId,scanId);
  assert.deepEqual(room.survey.walls[0].start,{x:-2.5,z:-2});
  const restored=parseWorkspace({items:[],layouts:[room]}).layouts[0];
  assert.equal(restored.survey?.scanId,scanId);assert.equal(duplicateLayout(restored).survey?.scanId,scanId);
  const metadata=nativeLayoutMetadata(restored);assert.equal(metadata.scanId,scanId);
  assert.deepEqual(metadata.walls,room.survey.walls.map(({start,end})=>({start,end})));
  assert.equal('floorY' in metadata,false);assert.equal('worldMap' in metadata,false);
});
test('old scans can use manual alignment; invalid tracking identities fail closed',()=>{
  const scan=parseRoomScan(fixture);assert.equal(scan.survey.scanId,undefined);
  const room={...createLayout('Old scan'),survey:scan.survey};assert.equal(nativeLayoutMetadata(room).scanId,null);
  assert.throws(()=>parseSurvey({...scan.survey,scanId:'../../private-file'}));
  assert.throws(()=>parseSurvey({...scan.survey,scanId:42}));
  assert.throws(()=>nativeLayoutMetadata(createLayout('Manual room')),/Scan this room/);
});
test('ordinary browsers cannot accidentally select the native preview route',async()=>{
  const previous=globalThis.window;
  try {
    (globalThis as any).window={};assert.equal(hasNativeRoomAR(),false);
    await assert.rejects(nativeRequest('preview',{}),/iPhone app/);
    let sent:any;
    (globalThis as any).window={furnitureARNativeVersion:1,webkit:{messageHandlers:{furnitureAR:{postMessage:async(message:any)=>{sent=message;return true;}}}}};
    assert.equal(hasNativeRoomAR(),true);await nativeRequest('scan');assert.deepEqual(sent,{version:1,kind:'scan',payload:undefined});
    (globalThis as any).window.furnitureARNativeVersion=2;assert.equal(hasNativeRoomAR(),false);
  } finally {(globalThis as any).window=previous;}
});
test('large binary transfers preserve bytes across base64 chunk boundaries',()=>{
  const bytes=Uint8Array.from({length:70_001},(_,i)=>i%256);
  assert.deepEqual(Buffer.from(bytesToBase64(bytes),'base64'),Buffer.from(bytes));
});
test('native USDZ export keeps metre scale, offset, and yaw without automatic plane anchoring',async()=>{
  const previousFetch=globalThis.fetch,previousWindow=globalThis.window;
  const data=readFileSync(new URL('../public/models/arc-chair-oat.glb',import.meta.url));
  try {
    (globalThis as any).window={location:{href:'https://furniture.test/'}};
    globalThis.fetch=async()=>new Response(data);
    const chair={...catalog[0],variants:[catalog[0].variants[1]]};
    const room=placeItem(scannedRoom(),createProductItem('https://example.com/chair',chair));
    room.items[0]={...room.items[0],x:1.25,z:-.75,rotation:90};
    const bytes=await exportNativeLayout(room);
    assert.equal(bytes[0],0x50);assert.equal(bytes[1],0x4b);
    const text=new TextDecoder().decode(bytes);
    assert.ok(text.includes('metersPerUnit = 1'));
    assert.equal(text.includes('preliminary:anchoring:type'),false);
    assert.ok(text.includes('1.25, 0, -0.75, 1'));
    // The serialized local matrix retains the negative Y rotation used by the map.
    assert.ok(text.includes('-1, 0, 2.220446049250313e-16, 0') || text.includes('-1, 0, 6.123233995736766e-17, 0'));
    assert.equal(room.items[0].x,1.25);
    const stage=new TextDecoder().decode(unzipSync(bytes)['model.usda']);
    assert.ok(stage.includes('</Root/Scenes/Scene/Materials/'), 'Native AR must retain materials inside its imported scene');
    assert.equal(stage.includes('</Materials/'),false);
    const controller=new AbortController();controller.abort();await assert.rejects(exportNativeLayout(room,controller.signal));
  } finally {globalThis.fetch=previousFetch;(globalThis as any).window=previousWindow;}
});

test('native room export retains the generated models’ baked vertex colors inside the aligned scene',async()=>{
  const previousFetch=globalThis.fetch,previousWindow=globalThis.window;
  const data=readFileSync(new URL('./browser/fixtures/vertex-colors.glb',import.meta.url));
  try {
    (globalThis as any).window={location:{href:'https://furniture.test/'}};
    globalThis.fetch=async()=>new Response(data);
    const product={...catalog[0],dimensions:{width:1,depth:1,height:1},variants:[catalog[0].variants[0]]};
    const room=placeItem(scannedRoom(),createProductItem('https://example.com/colored-model',product));
    room.items[0]={...room.items[0],x:-1,z:1,rotation:45};
    const files=unzipSync(await exportNativeLayout(room));
    const stage=new TextDecoder().decode(files['model.usda']);
    assert.match(stage,/inputs:diffuseColor.connect = <\/Root\/Scenes\/Scene\/Materials\/[^>]+\/VertexColorTexture_\d+\.outputs:rgb>/);
    assert.ok(Object.keys(files).some(path=>path.endsWith('.png')),'Baked colors must be included in the native transfer');
    assert.equal(stage.includes('preliminary:anchoring:type'),false);
    assert.ok(stage.includes('-1, 0, 1, 1'));
  } finally {globalThis.fetch=previousFetch;(globalThis as any).window=previousWindow;}
});
