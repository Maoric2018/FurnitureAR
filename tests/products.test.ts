import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { catalog, dimension, dimensionsMatch, getVariant, importProduct, parseProduct, validateAmazonUrl } from '../src/lib/products.ts';

test('Amazon input accepts product and short links, and rejects lookalikes and unsafe protocols', () => {
  for(const value of ['amazon.com/dp/B000DEMO01','https://www.amazon.co.uk/dp/B000DEMO01','https://a.co/d/abc','https://amzn.to/abc','https://www.amazon.com.au/dp/B000DEMO01']) assert.ok(validateAmazonUrl(value).startsWith('https://'));
  for(const value of ['', 'https://amazon.com','https://amazon.com.evil.example/dp/X','https://notamazon.com/dp/X','http://amazon.com/dp/X','javascript:alert(1)','https://user:pass@amazon.com/dp/X','https://amazon.com:444/dp/X']) assert.throws(()=>validateAmazonUrl(value));
});
test('Importer requires dimensions in meters and secure model URLs', () => {
  for(const product of catalog) assert.equal(parseProduct(product).id,product.id);
  assert.throws(()=>parseProduct({...catalog[0],dimensions:{width:NaN,height:.8,depth:.8}}));
  assert.throws(()=>parseProduct({...catalog[0],dimensions:{width:0,height:.8,depth:.8}}));
  assert.throws(()=>parseProduct({...catalog[0],dimensions:{width:78,height:81,depth:82}}));
  assert.throws(()=>parseProduct({...catalog[0],variants:[{...catalog[0].variants[0],modelSrc:'javascript:alert(1)'}]}));
  assert.throws(()=>parseProduct({...catalog[0],variants:[{...catalog[0].variants[0],modelSrc:'//example.com/model.glb'}]}));
  assert.throws(()=>parseProduct({...catalog[0],variants:[]}));
  assert.throws(()=>parseProduct({...catalog[0],variants:[catalog[0].variants[0],catalog[0].variants[0]]}));
});
test('Finish selection resolves its own ID without changing catalog order', () => {
  const product=catalog[0], order=product.variants.map(variant=>variant.id);
  assert.equal(getVariant(product,order[1]),product.variants[1]);
  assert.equal(getVariant(product),product.variants[0]);
  assert.equal(getVariant(product,'retired-finish'),product.variants[0]);
  assert.deepEqual(product.variants.map(variant=>variant.id),order);
});
test('Importer accepts explicit named-material previews and safe product-link metadata', () => {
  const variant={...catalog[0].variants[0],approximate:true,asin:'B000DEMO01',productUrl:'https://www.amazon.com/dp/B000DEMO01',
    materialOverrides:[{materialName:'Upholstery',color:'#223344'},{materialName:'Frame',color:'#AABBCC'}]};
  const parsed=parseProduct({...catalog[0],variants:[variant]});
  assert.deepEqual(parsed.variants[0],variant);
  assert.equal(parseProduct({...catalog[0],variants:[{...variant,approximate:false}]}).variants[0].approximate,false);
});
test('Importer rejects blank finish names and IDs and malformed optional preview metadata', () => {
  const base=catalog[0].variants[0];
  for(const change of [
    {id:''},{id:'  '},{name:''},{name:'\t '},{approximate:'true'},{approximate:null},
    {asin:''},{asin:'B000 DEMO1'},{asin:'too-short'},{asin:1234567890},
    {productUrl:''},{productUrl:'http://www.amazon.com/dp/B000DEMO01'},
    {productUrl:'https://amazon.com.evil.example/dp/B000DEMO01'},
    {productUrl:'https://user:password@amazon.com/dp/B000DEMO01'},
    {productUrl:'javascript:alert(1)'},{productUrl:123},
    {materialOverrides:null},{materialOverrides:{}},
    {materialOverrides:[null]},
    {materialOverrides:[{materialName:' ',color:'#112233'}]},
    {materialOverrides:[{materialName:'Frame',color:'#fff'}]},
    {materialOverrides:[{materialName:'Frame',color:'red'}]},
    {materialOverrides:[{materialName:'Frame',color:'#112233'},{materialName:'Frame',color:'#445566'}]},
  ]) assert.throws(()=>parseProduct({...catalog[0],variants:[{...base,...change}]}),JSON.stringify(change));
});
test('Unit conversion changes display without changing model dimensions', () => {
  assert.equal(dimension(.78,'cm'),'78');assert.equal(dimension(.254,'in'),'10.0');
  assert.equal(dimension(.78,'in'),'30.7');
});
test('AR rejects incorrect units and swapped model axes', () => {
  assert.equal(dimensionsMatch({x:.78,y:.81,z:.82},catalog[0].dimensions),true);
  assert.equal(dimensionsMatch({x:78,y:81,z:82},catalog[0].dimensions),false);
  assert.equal(dimensionsMatch({x:1.86,y:.9,z:.79},catalog[1].dimensions),false);
  assert.equal(dimensionsMatch({x:NaN,y:.81,z:.82},catalog[0].dimensions),false);
});
test('Importer sends the agreed payload, validates the response, and handles failures', async () => {
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async(url,options)=>{
      assert.equal(url,'/api/products/import'); assert.equal(options?.method,'POST');
      assert.deepEqual(JSON.parse(String(options?.body)),{url:'https://amazon.com/dp/B000DEMO01'});
      return new Response(JSON.stringify({product:catalog[0]}),{status:200});
    };
    assert.equal((await importProduct('https://amazon.com/dp/B000DEMO01','/api/products/import')).id,catalog[0].id);
    globalThis.fetch=async()=>new Response('{}',{status:502});
    await assert.rejects(importProduct('https://amazon.com/dp/B000DEMO01','/api/products/import'),/couldn’t import/);
    globalThis.fetch=async()=>new Response(JSON.stringify({product:{name:'Incomplete'}}),{status:200});
    await assert.rejects(importProduct('https://amazon.com/dp/B000DEMO01','/api/products/import'),/valid 3D model/);
  } finally {globalThis.fetch=original;}
});
test('Local importer errors expose bounded plain text for unsupported models and missing measurements', async () => {
  const original=globalThis.fetch;
  const locationDescriptor=Object.getOwnPropertyDescriptor(globalThis,'location');
  Object.defineProperty(globalThis,'location',{configurable:true,value:new URL('https://furniture.example/app')});
  try {
    for(const message of [
      'A 3D model is not available for this product yet.',
      'This listing is missing complete width, height, and length measurements in meters.',
      'Amazon returned a different product. Please check the product link and try again.',
      'Color <Oak> is unavailable.',
    ]) {
      globalThis.fetch=async()=>Response.json({error:message},{status:422});
      for(const endpoint of ['/api/products/import','https://furniture.example/api/products/import']) {
        await assert.rejects(importProduct('https://amazon.com/dp/B000DEMO01',endpoint),error=>error instanceof Error&&error.message===message);
      }
    }
    for(const body of [null,[],{}, {error:{message:'Nested message'}}, {error:42}, {error:''}, {error:'   '},
      {error:'x'.repeat(401)}, {error:'Unexpected\u0000control'}, {error:'Stack\ntrace'}]) {
      globalThis.fetch=async()=>Response.json(body,{status:502});
      await assert.rejects(importProduct('https://amazon.com/dp/B000DEMO01','/api/products/import'),/couldn’t import/);
    }
    globalThis.fetch=async()=>new Response('<html>Proxy error</html>',{status:502});
    await assert.rejects(importProduct('https://amazon.com/dp/B000DEMO01','/api/products/import'),/couldn’t import/);
  } finally {
    globalThis.fetch=original;
    if(locationDescriptor) Object.defineProperty(globalThis,'location',locationDescriptor);
    else Reflect.deleteProperty(globalThis,'location');
  }
});
test('External and redirected importer errors never expose response details or network exception text', async () => {
  const original=globalThis.fetch;
  const locationDescriptor=Object.getOwnPropertyDescriptor(globalThis,'location');
  Object.defineProperty(globalThis,'location',{configurable:true,value:new URL('https://furniture.example/app')});
  try {
    for(const endpoint of ['https://external.example/api/products/import','//external.example/api/products/import',
      '/api/products/import-lookalike','/other-importer','https://user:private-token@furniture.example/api/products/import']) {
      let readBody=false;
      globalThis.fetch=async()=>{
        const response=Response.json({error:'private-token upstream.example'},{status:502});
        response.json=async()=>{readBody=true;return {error:'private-token upstream.example'};};
        return response;
      };
      await assert.rejects(importProduct('https://amazon.com/dp/B000DEMO01',endpoint),/couldn’t import/);
      assert.equal(readBody,false);
    }
    globalThis.fetch=async()=>{
      const response=Response.json({error:'private-token upstream.example'},{status:502});
      Object.defineProperty(response,'redirected',{value:true});
      return response;
    };
    await assert.rejects(importProduct('https://amazon.com/dp/B000DEMO01','/api/products/import'),/couldn’t import/);
    globalThis.fetch=async()=>{throw new Error('private-token upstream.example');};
    await assert.rejects(importProduct('https://amazon.com/dp/B000DEMO01','https://external.example/import'),/couldn’t import/);
    globalThis.fetch=async()=>{throw new DOMException('Aborted','AbortError');};
    await assert.rejects(importProduct('https://amazon.com/dp/B000DEMO01','/api/products/import'),{name:'AbortError'});
  } finally {
    globalThis.fetch=original;
    if(locationDescriptor) Object.defineProperty(globalThis,'location',locationDescriptor);
    else Reflect.deleteProperty(globalThis,'location');
  }
});
test('Successful HTTP responses still require readable JSON with a valid product', async () => {
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response('<html>Unexpected gateway page</html>',{status:200});
    await assert.rejects(importProduct('https://amazon.com/dp/B000DEMO01','/api/products/import'),/unreadable response/);
    for(const body of [null,[],{},'Unexpected string']) {
      globalThis.fetch=async()=>Response.json(body);
      await assert.rejects(importProduct('https://amazon.com/dp/B000DEMO01','/api/products/import'),/returned no product/);
    }
  } finally {globalThis.fetch=original;}
});
for(const product of catalog) for(const variant of product.variants) {
  test(`${product.name} / ${variant.name}: GLB bounds match catalog within 0.1 mm, centered on floor`,async()=>{
    const bytes=await readFile(new URL(`../public${variant.modelSrc}`,import.meta.url));
    const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    const box=new Box3().setFromObject(gltf.scene), size=box.getSize(new Vector3());
    for(const [actual,expected] of [[size.x,product.dimensions.width],[size.y,product.dimensions.height],[size.z,product.dimensions.depth]]) assert.ok(Math.abs(actual-expected)<.0001,`${actual} != ${expected}`);
    assert.ok(Math.abs(box.min.y)<.0001,'Bottom must sit on the floor');
    assert.ok(Math.abs(box.getCenter(new Vector3()).x)<.0001,'Centered horizontally');
    if(product.id==='arc-chair' && variant.id==='sage') {
      const usdz=await new USDZExporter().parseAsync(gltf.scene);
      assert.equal(usdz[0],0x50);assert.equal(usdz[1],0x4b);assert.ok(usdz.length>1000,'Model exports to a USDZ archive for iPhone');
    }
  });
}
