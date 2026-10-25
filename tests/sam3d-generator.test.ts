import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSam3dGenerator } from '../server/model-generator.js';
import { normalizeSamGlb } from '../server/sam3d-glb.js';
import { createModelService } from '../server/model-service.js';
import { normalizeImport } from '../server/amazon-import.js';
import { parseAmazonProductResult } from '../src/lib/amazon.ts';
import { createImportedItem, createLayout, placeItem } from '../src/lib/workspace.ts';

const env = { MODEL_API_URL: 'https://sam.example/v1', MODEL_API_KEY: 'secret-for-server-only' };
const input = { asin: 'B012345678', imageUrl: 'https://m.media-amazon.com/images/product.jpg',
  idempotencyKey: 'furniture-ar:amazon-com:B012345678:sam3d-amazon-v1', listing: { dimensions: { height: .75 } }, signal: new AbortController().signal };
const photo = new Uint8Array([137,80,78,71,13,10,26,10,0]);

function mesh(edit: (doc: any, binary: Uint8Array) => void = () => {}) {
  const positions = new Float32Array([-1,-2,-3, 1,2,3, 1,-2,3]);
  const binary = new Uint8Array(positions.buffer);
  const doc = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ translation: [7,8,9], children: [1] }, { mesh: 0, scale: [2,2,2] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: binary.length }], bufferViews: [{ buffer: 0, byteLength: binary.length }],
    // Incorrect hints deliberately prove normalization reads the real positions.
    accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 3, min: [0,0,0], max: [99,99,99] }] };
  edit(doc,binary);
  const json = new TextEncoder().encode(JSON.stringify(doc)), length = Math.ceil(json.length/4)*4;
  const bytes = new Uint8Array(28+length+binary.length), v = new DataView(bytes.buffer);
  v.setUint32(0,0x46546c67,true); v.setUint32(4,2,true); v.setUint32(8,bytes.length,true);
  v.setUint32(12,length,true); v.setUint32(16,0x4e4f534a,true); bytes.fill(32,20,20+length); bytes.set(json,20);
  v.setUint32(20+length,binary.length,true); v.setUint32(24+length,0x004e4942,true); bytes.set(binary,28+length);
  return bytes;
}

test('SAM normalization preserves actual proportions, nested transforms and binary data at a metric floor origin', async () => {
  const source = mesh(), result = normalizeSamGlb(source,{ height: .75 });
  assert.deepEqual(result.dimensions,{ width: .375, height: .75, depth: 1.125 });
  assert.equal(result.scaleReference,'height');
  assert.deepEqual(result.glb.slice(-36),source.slice(-36));
  const loaded = await new GLTFLoader().parseAsync(result.glb.buffer,'');
  const box = new Box3().setFromObject(loaded.scene,true), center = box.getCenter(new Vector3());
  assert.equal(box.min.y,0); assert.equal(center.x,0); assert.equal(center.z,0);
  assert.deepEqual(box.getSize(new Vector3()).toArray(),[.375,.75,1.125]);
  assert.equal(normalizeSamGlb(source,{ width: 2 }).dimensions.width,2);
  assert.equal(normalizeSamGlb(source,null).scaleReference,'preview');
});

test('Malformed, nonfinite, external, animated and excessively complex geometry cannot become a cached model', () => {
  for (const edit of [
    (d:any) => { d.nodes[1].children=[0]; },
    (d:any) => { d.accessors[0].count=2_000_001; },
    (d:any) => { d.accessors[0].byteOffset=10000; },
    (d:any) => { d.buffers[0].uri='https://private.example/asset'; },
    (d:any) => { d.animations=[{}]; },
    (_d:any,b:Uint8Array) => { new DataView(b.buffer).setFloat32(0,Infinity,true); },
  ]) assert.throws(()=>normalizeSamGlb(mesh(edit),{height:1}));
});

test('Real adapter contract: CDN photo → stable private job → status → normalized GLB; no provider URLs trusted', async () => {
  const keys:string[]=[]; let modelCalls=0;
  const generator=createSam3dGenerator({fetchImpl:async (url:string, init:RequestInit)=>{
    assert.equal(init.signal,input.signal); assert.equal(init.redirect,'manual');
    if(url===input.imageUrl){assert.equal(init.headers,undefined);return new Response(photo);}
    const headers=init.headers as Record<string,string>;
    assert.equal(headers.Authorization,`Bearer ${env.MODEL_API_KEY}`);
    assert.equal(headers['X-Furniture-User'],'furniture-ar:amazon-com');
    if(init.method==='POST'){
      keys.push(headers['Idempotency-Key']);assert.match(keys.at(-1)!,/^[a-f0-9-]{36}$/);
      const uploaded=(init.body as FormData).get('image') as File;
      assert.equal(uploaded.type,'image/png');assert.equal(uploaded.name,'product.png');
      assert.deepEqual(new Uint8Array(await uploaded.arrayBuffer()),photo);
      return Response.json({id:'job_1',status:'queued',stage:'preparing'});
    }
    if(url==='https://sam.example/v1/jobs/job_1/model'){modelCalls++;return new Response(mesh());}
    assert.equal(url,'https://sam.example/v1/jobs/job_1');
    return Response.json({id:'job_1',status:'succeeded',model_url:'https://untrusted.example/glb'});
  }});
  assert.deepEqual(await generator.start(input,{}),{status:'not_configured'});
  assert.deepEqual(await generator.start(input,env),{status:'pending',jobId:'job_1',stage:'preparing'});
  await generator.start(input,env);assert.equal(keys[0],keys[1]);
  await generator.start({...input,idempotencyKey:input.idempotencyKey+'different-asin'},env);assert.notEqual(keys[1],keys[2]);
  const ready=await generator.poll({...input,jobId:'job_1'},env);
  assert.equal(ready.status,'ready');assert.equal(ready.dimensions.height,.75);assert.equal(modelCalls,1);
});

test('Only approved Amazon CDN photos are downloaded; redirects, oversized files and invalid signatures fail closed', async () => {
  let calls=0;
  const generator=createSam3dGenerator({fetchImpl:async()=>{calls++;return new Response(photo);}});
  for(const imageUrl of ['http://m.media-amazon.com/a','https://localhost/a','https://m.media-amazon.com.evil.test/a','https://user@m.media-amazon.com/a']){
    await assert.rejects(generator.start({...input,imageUrl},env));
  }
  assert.equal(calls,0);
  for(const response of [new Response(null,{status:302,headers:{Location:'http://127.0.0.1/'}}),new Response('html'),new Response(photo,{headers:{'Content-Length':String(9*1024*1024)}})]){
    let calls=0; const g=createSam3dGenerator({fetchImpl:async()=>{calls++;return response;}});
    if(response.status===302)assert.equal((await g.start(input,env)).status,'failed');
    else await assert.rejects(g.start(input,env));
    assert.equal(calls,1);
  }
});

class Bucket {
  entries=new Map<string,{bytes:Uint8Array;etag:string}>(); n=0;
  async get(key:string){const value=this.entries.get(key);return value?{size:value.bytes.length,etag:value.etag,body:value.bytes,text:async()=>new TextDecoder().decode(value.bytes)}:null;}
  async head(key:string){return this.get(key);}
  async put(key:string,value:string|Uint8Array,options:any){const previous=this.entries.get(key);
    if(options?.onlyIf?.etagMatches&&previous?.etag!==options.onlyIf.etagMatches)return null;
    if(options?.onlyIf?.etagDoesNotMatch==='*'&&previous)return null;
    const object={bytes:typeof value==='string'?new TextEncoder().encode(value):value,etag:String(++this.n)};this.entries.set(key,object);return object;}
}
test('Latest cache passes credentials privately, survives a poll outage, persists real bytes and blocks unmeasured room placement', async()=>{
  const bucket=new Bucket();let time=1000,starts=0,polls=0;
  const lookup=async()=>normalizeImport({product_results:{asin:input.asin,title:'Lamp',thumbnails:[input.imageUrl]}},input.asin);
  const service=createModelService({lookup,now:()=>time,generator:{version:'integration',
    start:async (_:unknown,received:unknown)=>{assert.equal(received,configured);starts++;return {status:'pending',jobId:'private-job'};},
    poll:async()=>{if(++polls===1)throw new Error('temporary secret failure');return {status:'ready',...normalizeSamGlb(mesh(),null)};}}});
  const configured={...env,MODEL_BUCKET:bucket};
  assert.equal((await service.load(input.asin,configured)).model.status,'pending');time+=3001;
  const retry=await service.load(input.asin,configured,true);assert.equal(retry.model.status,'pending');
  assert(!JSON.stringify(retry).includes(env.MODEL_API_KEY));time+=3001;
  const result=await service.load(input.asin,configured,true);assert.equal(result.model.status,'ready');
  const parsed=parseAmazonProductResult(result);assert.equal(parsed.product?.scaleReference,'preview');
  assert.throws(()=>placeItem(createLayout('Room','Living room',5,4),createImportedItem(parsed.listing,parsed.product)),/measurement/);
  const cached=await createModelService({lookup:async()=>{throw new Error('No lookup on cache hit');}}).load(input.asin,configured);
  assert.equal(cached.model.source,'cache');assert.equal(starts,1);assert.equal(polls,2);
});
