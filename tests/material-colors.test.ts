import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { cloneModelMaterials, createThreeColorController } from '../src/lib/material-colors.ts';
import { arrangeModels } from '../src/lib/layout-model.ts';
import { placeholderProduct, createProductItem } from '../src/lib/workspace.ts';
import type { FurnitureProduct } from '../src/lib/products.ts';

function sampleModel(textured = true) {
  const body = new MeshStandardMaterial({color:'#b68d5d',roughness:.7,metalness:.15,opacity:.85});
  body.name='wood';
  body.userData={supplier:'original',nested:{finish:'oak'}};
  if (textured) { body.map=new Texture(); body.normalMap=new Texture(); body.roughnessMap=new Texture(); }
  const metal = new MeshStandardMaterial({color:'#111111',roughness:.2,metalness:1});
  metal.name='hardware';
  const group = new Group();
  group.add(new Mesh(new BoxGeometry(1,.5,1),body),new Mesh(new BoxGeometry(.1,.6,.1),metal));
  return {group,body,metal};
}
const materialOf = (group:Group, index=0) => (group.children[index] as Mesh).material as MeshStandardMaterial;

test('Finish colors replace only named albedo maps and restore the original without cumulative tinting',()=>{
  const {group,body,metal}=sampleModel();
  const originalColor=body.color.clone(),originalMap=body.map,normalMap=body.normalMap,roughnessMap=body.roughnessMap;
  const controller=createThreeColorController(group);
  for(const color of ['#282828','#b76644','#ffffff']) {
    controller.apply([{materialName:'wood',color}]);
    assert.equal(body.color.getHexString(),color.slice(1));
    assert.equal(body.map,null);
    assert.equal(body.normalMap,normalMap);assert.equal(body.roughnessMap,roughnessMap);
    assert.equal(body.opacity,.85);assert.equal(body.roughness,.7);assert.equal(body.metalness,.15);
    assert.equal(metal.color.getHexString(),'111111');
  }
  controller.apply();
  assert.equal(body.color.equals(originalColor),true);assert.equal(body.map,originalMap);
  controller.apply([{materialName:'wood',color:'#ffffff'}]);
  controller.restore();
  assert.equal(body.color.equals(originalColor),true);assert.equal(body.map,originalMap);
  assert.deepEqual(body.userData,{supplier:'original',nested:{finish:'oak'}});
});

test('Each placed model gets independent materials while retaining geometry, texture details and metadata',()=>{
  const {group,body}=sampleModel();
  group.add(new Mesh(new BoxGeometry(.2,.3,.4),body));
  const first=cloneModelMaterials(group),second=cloneModelMaterials(group);
  assert.notEqual(materialOf(first),body);assert.notEqual(materialOf(first),materialOf(second));
  assert.equal(materialOf(first),materialOf(first,2));
  assert.equal((first.children[0] as Mesh).geometry,(group.children[0] as Mesh).geometry);
  assert.equal(materialOf(first).normalMap,body.normalMap);
  assert.deepEqual(materialOf(first).userData,body.userData);
  assert.notEqual(materialOf(first).userData.nested,body.userData.nested);
  createThreeColorController(first).apply([{materialName:'wood',color:'#ffffff'}]);
  createThreeColorController(second).apply([{materialName:'wood',color:'#282828'}]);
  assert.equal(materialOf(first).color.getHexString(),'ffffff');
  assert.equal(materialOf(second).color.getHexString(),'282828');
  assert.equal(body.color.getHexString(),'b68d5d');assert.ok(body.map);
});

test('Invalid or absent exact material targets reject the entire change',()=>{
  const {group,body}=sampleModel();
  const original=body.color.clone(),map=body.map;
  const controller=createThreeColorController(group);
  for(const overrides of [
    [{materialName:'Wood',color:'#ffffff'}],
    [{materialName:'wood',color:'white'}],
    [{materialName:'wood',color:'#ffffff'},{materialName:'missing',color:'#000000'}],
    [{materialName:'wood',color:'#ffffff'},{materialName:'wood',color:'#000000'}],
  ]) assert.throws(()=>controller.apply(overrides));
  assert.equal(body.color.equals(original),true);assert.equal(body.map,map);
});

test('Layout arrangement uses selected model sources and keeps instance colors, positions and scale independent',()=>{
  const first=sampleModel(),alternative=sampleModel();
  alternative.group.scale.setScalar(1.2);
  const product:FurnitureProduct={...placeholderProduct,variants:[
    {id:'oak',name:'Oak',color:'#b68d5d',modelSrc:'/original.glb'},
    {id:'white',name:'White',color:'#ffffff',modelSrc:'/other.glb',materialOverrides:[{materialName:'wood',color:'#ffffff'}]},
    {id:'black',name:'Black',color:'#282828',modelSrc:'/other.glb',materialOverrides:[{materialName:'wood',color:'#282828'}]},
  ]};
  const item=createProductItem('https://example.com/table',product);
  const scene=arrangeModels([
    {...item,id:'white',variantId:'white',x:.6,z:-.4,rotation:90},
    {...item,id:'black',variantId:'black',x:-.8,z:.3,rotation:45},
    {...item,id:'original',variantId:'oak',x:0,z:1,rotation:0},
  ],new Map([['/original.glb',first.group],['/other.glb',alternative.group]]));
  const [white,black,oak]=scene.children as Group[];
  assert.equal(materialOf(white).color.getHexString(),'ffffff');
  assert.equal(materialOf(black).color.getHexString(),'282828');
  assert.equal(materialOf(oak).color.getHexString(),'b68d5d');
  assert.deepEqual(white.position.toArray(),[.6,0,-.4]);assert.equal(white.rotation.y,-Math.PI/2);
  assert.deepEqual(white.scale.toArray(),[1.2,1.2,1.2]);assert.deepEqual(oak.scale.toArray(),[1,1,1]);
  assert.equal(alternative.body.color.getHexString(),'b68d5d');
});

test('Every placeholder finish target exists in the supplied table GLB metadata',async()=>{
  const bytes=await readFile(new URL('../public/models/little-tree-oak-table.glb',import.meta.url));
  const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  const names=new Set(gltf.materials.map((material:{name:string})=>material.name));
  for(const variant of placeholderProduct.variants) for(const override of variant.materialOverrides??[]) assert.ok(names.has(override.materialName));
});

test('GLB and USDZ exporters encode the independently selected solid colors',async()=>{
  // FileReader is the only browser facility the binary GLTFExporter needs for
  // these texture-free meshes; use Blob's real bytes rather than a fake export.
  const previous=globalThis.FileReader;
  class BlobReader {
    result:ArrayBuffer|null=null;
    onloadend:(()=>void)|null=null;
    readAsArrayBuffer(blob:Blob) { void blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();}); }
  }
  globalThis.FileReader=BlobReader as unknown as typeof FileReader;
  try {
    const {group}=sampleModel(false);
    const product:FurnitureProduct={...placeholderProduct,variants:[
      {id:'terracotta',name:'Terracotta',color:'#b76644',modelSrc:'/table.glb',materialOverrides:[{materialName:'wood',color:'#b76644'}]},
      {id:'white',name:'White',color:'#ffffff',modelSrc:'/table.glb',materialOverrides:[{materialName:'wood',color:'#ffffff'}]},
    ]};
    const item=createProductItem('https://example.com/table',product);
    const scene=arrangeModels([
      {...item,id:'one',variantId:'terracotta',x:-1,z:0,rotation:0},
      {...item,id:'two',variantId:'white',x:1,z:0,rotation:0},
    ],new Map([['/table.glb',group]]));
    const exported=await new GLTFExporter().parseAsync(scene,{binary:true}) as ArrayBuffer;
    const view=new DataView(exported);
    assert.equal(view.getUint32(0,true),0x46546c67);
    const gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(exported,20,view.getUint32(12,true))));
    const materials=gltf.materials.filter((material:{name:string})=>material.name==='wood');
    assert.equal(materials.length,2);
    for(const [index,color] of ['#b76644','#ffffff'].entries()) {
      assert.deepEqual(materials[index].pbrMetallicRoughness.baseColorFactor,[...new Color(color).toArray(),.85]);
      assert.equal(materials[index].pbrMetallicRoughness.baseColorTexture,undefined);
      assert.deepEqual(materials[index].extras,{supplier:'original',nested:{finish:'oak'}});
    }
    // USDZ stores uncompressed USD text, so inspect the actual exported diffuse
    // factors that Quick Look consumes rather than merely checking its ZIP header.
    const usdz=await new USDZExporter().parseAsync(scene);
    const usd=new TextDecoder().decode(usdz);
    for(const color of ['#b76644','#ffffff']) {
      const rgb=new Color(color).toArray().join(', ');
      assert.ok(usd.includes(`color3f inputs:diffuseColor = (${rgb})`));
    }
    assert.equal(usd.includes('color3f inputs:diffuseColor.connect'),false);
  } finally { globalThis.FileReader=previous; }
});
