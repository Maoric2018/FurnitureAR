import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { catalog, dimension, dimensionsMatch, importProduct, parseProduct, validateAmazonUrl } from '../src/lib/products.ts';

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
