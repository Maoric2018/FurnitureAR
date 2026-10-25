import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3,Group,Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import { createUrbanDemoRoom, createUrbanDemoProposal, createUrbanDemoProposals, runUrbanDemo, URBAN_DEMO_PRODUCTS, URBAN_DEMO_OPTIONS, URBAN_DEMO_NAME } from '../src/lib/urban-demo.ts';
import { parseWorkspace } from '../src/lib/workspace.ts';
import { placementWarnings } from '../src/lib/room-scan.ts';
import { arrangeModels, exportNativeLayout } from '../src/lib/layout-model.ts';
import worker from '../worker/index.ts';

test('prepared scan preserves its measured room and adds five fitting pieces from three real listings',()=>{
  const room=createUrbanDemoRoom(),proposal=createUrbanDemoProposal();
  assert.equal(room.items.length,0);assert.equal(room.survey?.walls.length,9);assert.equal(room.survey?.obstacles.length,3);
  assert.ok(Math.abs(room.width-3.41984)<.001);assert.ok(Math.abs(room.depth-3.63167)<.001);
  assert.deepEqual(proposal.layout.survey,room.survey);
  assert.equal(proposal.layout.items.length,5);
  assert.equal(new Set(proposal.layout.items.map(item=>item.sourceUrl)).size,3);
  assert.equal(new Set(proposal.layout.items.map(item=>item.id)).size,5);
  for(const item of proposal.layout.items){
    assert.deepEqual(placementWarnings(item,proposal.layout),[],item.name);
    assert.ok(URBAN_DEMO_PRODUCTS.some(product=>product.url===item.sourceUrl));
  }
  const restored=parseWorkspace(JSON.parse(JSON.stringify({layouts:[proposal.layout]}))).layouts[0];
  assert.equal(restored.items.filter(item=>item.elevation===1.3).length,3);
  assert.deepEqual(restored.survey,room.survey);
  const another=createUrbanDemoProposal();assert.notEqual(another.layout.id,proposal.layout.id);
  assert.equal(another.layout.items.length,5,'Repeating the preset must not accumulate pieces');
  assert.equal(room.items.length,0,'Preparing a demo must not mutate its starting room');
});

test('three distinct arrangements reuse the same five products without collisions or changing the original',()=>{
  const proposals=createUrbanDemoProposals(),room=createUrbanDemoRoom(),original=createUrbanDemoProposal();
  assert.equal(proposals.length,3);assert.equal(URBAN_DEMO_OPTIONS.length,3);
  assert.equal(original.name,URBAN_DEMO_NAME);
  const placements=(layout:typeof original.layout)=>layout.items.map(({product,x,z,rotation,elevation})=>({product:product.id,x,z,rotation,elevation}));
  assert.deepEqual(placements(proposals[0].layout),placements(original.layout));
  assert.equal(new Set(proposals.map(proposal=>JSON.stringify(placements(proposal.layout)))).size,3);
  assert.equal(new Set(proposals.map(proposal=>proposal.id)).size,3);
  assert.equal(new Set(proposals.map(proposal=>proposal.layout.id)).size,3);
  assert.equal(new Set(proposals.flatMap(proposal=>proposal.layout.items.map(item=>item.id))).size,15);
  const expected=original.layout.items.map(item=>({id:item.product.id,url:item.sourceUrl,asin:item.product.variants[0].asin}));
  for(const [index,proposal] of proposals.entries()){
    assert.equal(proposal.layout.items.length,5);
    assert.equal(proposal.description,URBAN_DEMO_OPTIONS[index].description);
    assert.deepEqual(proposal.layout.survey,room.survey);
    assert.deepEqual(proposal.layout.items.map(item=>({id:item.product.id,url:item.sourceUrl,asin:item.product.variants[0].asin})),expected);
    for(const item of proposal.layout.items)assert.deepEqual(placementWarnings(item,proposal.layout),[],`${URBAN_DEMO_OPTIONS[index].name}: ${item.name}`);
    const restored=parseWorkspace(JSON.parse(JSON.stringify({layouts:[proposal.layout]}))).layouts[0];
    assert.deepEqual(placements(restored),placements(proposal.layout));
    assert.equal(restored.items.filter(item=>item.elevation===1.3).length,3);
  }
});

test('all bundled demo models have their declared dimensions and colored materials',async()=>{
  const models=new Map<string,Group>();
  for(const item of createUrbanDemoProposal().layout.items){
    const src=item.product.variants[0].modelSrc;
    const bytes=readFileSync(new URL(`../public${src}`,import.meta.url));
    const model=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    const bounds=new Box3().setFromObject(model.scene,true),size=bounds.getSize(new Vector3()),d=item.product.dimensions;
    assert.ok(Math.abs(size.x-d.width)<.00001&&Math.abs(size.y-d.height)<.00001&&Math.abs(size.z-d.depth)<.00001,item.name);
    assert.ok(Math.abs(bounds.min.y)<.00001,'Assets start on the floor before layout elevation is applied');
    let colored=false;model.scene.traverse((object:any)=>{if(object.isMesh){const materials=Array.isArray(object.material)?object.material:[object.material];colored ||=materials.some((material:any)=>material.color && material.color.getHex()!==0xffffff);}});
    assert.ok(colored,item.name);
    models.set(src,model.scene);
  }
  const inwardNormals=[new Vector3(1,0,0),new Vector3(-1,0,0),new Vector3(0,0,-1)];
  for(const [index,proposal] of createUrbanDemoProposals().entries()){
    const scene=arrangeModels(proposal.layout.items,models);scene.updateMatrixWorld(true);
    for(const item of proposal.layout.items.filter(item=>item.product.placementKind==='wall')){
      const object=scene.getObjectByName(item.name)!;
      assert.ok(object.getWorldDirection(new Vector3()).dot(inwardNormals[index])>.999,'Every picture faces into the room from its mounting wall');
      assert.equal(object.position.y,1.3);
    }
  }
});

test('published design endpoint is disabled even with provider keys, without reading prompt/photos or calling providers',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new Error('An external call must never run in demo mode');});
  const env={ASSETS:{fetch:async()=>new Response('asset')},ANTHROPIC_API_KEY:'fake-test-key',SERPAPI_API_KEY:'fake-test-key'};
  const status=await worker.fetch(new Request('https://roomify.test/api/design/room'),env);
  assert.deepEqual(await status.json(),{mode:'demo',configured:false,shopping:false,signedIn:false,authorized:true});
  const request=new Request('https://roomify.test/api/design/room',{method:'POST',body:'not even JSON'});
  const response=await worker.fetch(request,env);
  assert.equal(response.status,503);assert.equal((await response.json() as any).error.code,'DESIGN_DEMO_MODE');
  assert.equal(request.bodyUsed,false);assert.equal(fetch.mock.calls.length,0);
});

test('canceling simulated preparation never applies a late result or contacts a backend',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new Error('No API requests');});
  const controller=new AbortController(),stages:number[]=[];
  const pending=runUrbanDemo(controller.signal,stage=>stages.push(stage));
  controller.abort();await assert.rejects(pending,error=>error instanceof DOMException&&error.name==='AbortError');
  assert.deepEqual(stages,[0]);assert.equal(fetch.mock.calls.length,0);
});

test('simulated preparation returns all three choices without contacting a backend',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',async()=>{throw new Error('No API requests');});
  t.mock.timers.enable({apis:['setTimeout']});
  const stages:number[]=[],pending=runUrbanDemo(new AbortController().signal,stage=>stages.push(stage));
  for(let i=0;i<4;i++){t.mock.timers.tick(850);await Promise.resolve();}
  const proposals=await pending;
  assert.deepEqual(stages,[0,1,2,3]);assert.equal(proposals.length,3);assert.equal(fetch.mock.calls.length,0);
});

test('all three presets export colored AR scenes with elevated pictures and floor-level rugs',async()=>{
  const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
  try{
    (globalThis as any).window={location:{href:'https://roomify.test/'}};
    globalThis.fetch=async input=>{
      const path=String(input);assert.ok(path.startsWith('/models/urban-demo/'));
      return new Response(readFileSync(new URL(`../public${path}`,import.meta.url)));
    };
    for(const proposal of createUrbanDemoProposals()){
      const bytes=await exportNativeLayout(proposal.layout);
      assert.ok(bytes.byteLength<12_000_000,'Preloaded demonstration should be small enough for phone AR');
      const files=unzipSync(bytes),stage=new TextDecoder().decode(files['model.usda']);
      for(const item of proposal.layout.items)assert.ok(stage.includes(`${item.x}, ${item.elevation??0}, ${item.z}, 1`),`${proposal.name}: ${item.name} keeps its placement and height in USDZ`);
      assert.ok(stage.includes('</Root/Scenes/Scene/Materials/'));assert.equal(stage.includes('preliminary:anchoring:type'),false);
    }
  }finally{globalThis.fetch=originalFetch;(globalThis as any).window=originalWindow;}
});
