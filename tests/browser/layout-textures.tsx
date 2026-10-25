import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import { Cache } from 'three';
import type { Mesh, Material, Texture } from 'three';
import { exportLayout } from '../../src/lib/layout-model';
import { Viewer } from '../../src/components/Viewer';
import { placeholderProduct, createProductItem } from '../../src/lib/workspace';
import type { RoomLayout } from '../../src/lib/workspace';
import type { FurnitureProduct, FurnitureVariant } from '../../src/lib/products';

const report=document.querySelector<HTMLPreElement>('#report')!;
const status=document.querySelector<HTMLParagraphElement>('#status')!;
const previews=document.querySelector<HTMLDivElement>('#previews')!;
const log=(value:unknown)=>{report.textContent+=`${typeof value==='string'?value:JSON.stringify(value,null,2)}\n`;};
const assert=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
const urls:string[]=[];
const roots:Root[]=[];
let running=false;
async function locked(action:()=>Promise<void>){
  if(running)return;
  running=true;document.querySelectorAll<HTMLButtonElement>('body > button').forEach(button=>button.disabled=true);
  try{await action();}catch(error){status.textContent=`FAIL: ${(error as Error).message}`;status.className='fail';log((error as Error).stack);}
  finally{running=false;document.querySelectorAll<HTMLButtonElement>('body > button').forEach(button=>button.disabled=false);}
}

interface Document { json:any; binaryOffset:number; bytes:ArrayBuffer }
function glb(bytes:ArrayBuffer):Document {
  const view=new DataView(bytes);
  assert(view.getUint32(0,true)===0x46546c67,'Expected binary glTF');
  const length=view.getUint32(12,true);
  return {json:JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,length))),binaryOffset:28+length,bytes};
}
function materials(doc:Document) {
  return (doc.json.materials??[]).map((material:any)=>({name:material.name??'',factor:material.pbrMetallicRoughness?.baseColorFactor??[1,1,1,1],baseColorTexture:material.pbrMetallicRoughness?.baseColorTexture?.index??null,normalTexture:material.normalTexture?.index??null}));
}
async function pixels(blob:Blob) {
  assert(blob.size>32,'Embedded texture is empty');
  const imageBitmap=await createImageBitmap(blob);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=32;
  const context=canvas.getContext('2d',{willReadFrequently:true})!;
  context.drawImage(imageBitmap,0,0,32,32);imageBitmap.close();
  const bytes=context.getImageData(0,0,32,32).data;
  const mean=[0,0,0];let min=255,max=0;
  for(let offset=0;offset<bytes.length;offset+=4)for(let channel=0;channel<3;channel++){mean[channel]+=bytes[offset+channel]/1024;min=Math.min(min,bytes[offset+channel]);max=Math.max(max,bytes[offset+channel]);}
  return {mean:mean.map(value=>Math.round(value)),min,max};
}
async function texturePixels(doc:Document,textureIndex:number) {
  const image=doc.json.images[doc.json.textures[textureIndex].source];
  let blob:Blob;
  if(image.bufferView!==undefined){
    const view=doc.json.bufferViews[image.bufferView];
    blob=new Blob([doc.bytes.slice(doc.binaryOffset+(view.byteOffset??0),doc.binaryOffset+(view.byteOffset??0)+view.byteLength)],{type:image.mimeType});
  }else{assert(image.uri?.startsWith('data:'),'Exported image must be embedded');blob=await (await fetch(image.uri)).blob();}
  return pixels(blob);
}
function vertexColors(doc:Document):number[] {
  return (doc.json.meshes??[]).flatMap((mesh:any)=>mesh.primitives.flatMap((primitive:any)=>{
    if(primitive.attributes.COLOR_0===undefined)return [];
    const accessor=doc.json.accessors[primitive.attributes.COLOR_0],buffer=doc.json.bufferViews[accessor.bufferView];
    const components=accessor.type==='VEC4'?4:3,componentBytes=accessor.componentType===5126?4:accessor.componentType===5123?2:1;
    const view=new DataView(doc.bytes,doc.binaryOffset+(buffer.byteOffset??0)+(accessor.byteOffset??0));
    return Array.from({length:accessor.count*components},(_,index)=>{
      const offset=Math.floor(index/components)*(buffer.byteStride??components*componentBytes)+(index%components)*componentBytes;
      const value=accessor.componentType===5126?view.getFloat32(offset,true):accessor.componentType===5123?view.getUint16(offset,true):view.getUint8(offset);
      return accessor.normalized?value/(accessor.componentType===5123?65535:255):value;
    });
  }));
}
async function checkUsdz(target:Document,name:string) {
  const loaded=await new GLTFLoader().parseAsync(target.bytes,location.href);
  const bytes=await new USDZExporter().parseAsync(loaded.scene);
  const files=unzipSync(bytes);
  const text=Object.entries(files).filter(([name])=>/\.usda?$/.test(name)).map(([,bytes])=>new TextDecoder().decode(bytes)).join('\n');
  assert(text.includes('UsdPreviewSurface'),'USDZ has no surface shader');
  const textures=Object.keys(files).filter(name=>name.startsWith('textures/'));
  const diffuseIds=[...text.matchAll(/Texture_(\d+)_diffuse\.outputs:rgb/g)].map(match=>match[1]);
  const hasBaseTextures=materials(target).some((material:any)=>material.baseColorTexture!==null);
  if(hasBaseTextures)assert(diffuseIds.length>0,'USDZ dropped diffuse texture connections');
  for(const material of materials(target)){
    if(material.baseColorTexture===null)assert(text.includes(`color3f inputs:diffuseColor = (${material.factor.slice(0,3).join(', ')})`),`${material.name}: USDZ lost the solid material color`);
  }
  for(const id of new Set(diffuseIds)){
    const entry=text.match(new RegExp(`def Shader "Texture_${id}_diffuse"\\s*\\{[\\s\\S]*?asset inputs:file = @([^@]+)@`))?.[1];
    assert(entry&&files[entry],`USDZ is missing diffuse texture ${id}`);
    const sample=await pixels(new Blob([files[entry!]],{type:'image/png'}));
    log({case:name,usdzDiffuseTexture:entry,pixels:sample});
  }
  log({case:name,usdzBytes:bytes.byteLength,usdzTextures:textures.length,usdzDiffuseConnections:diffuseIds.length,usdzDisplayColor:text.includes('primvars:displayColor')});
}
function layout(product:FurnitureProduct,variant:FurnitureVariant):RoomLayout {
  const item=createProductItem('https://www.amazon.com/dp/B0F2ML48Y6',product);
  return {id:`qa-${product.id}-${variant.id}`,name:`QA ${product.name}`,roomType:'Test',width:5,depth:4,updatedAt:new Date().toISOString(),items:[{...item,variantId:variant.id,x:0,z:0,rotation:0}]};
}
function view(name:string,source:string,exported:string,product:FurnitureProduct,variant:FurnitureVariant,dimensions:FurnitureProduct['dimensions']) {
  const host=document.createElement('section');host.className='case';previews.append(host);
  const root=createRoot(host);roots.push(root);
  root.render(<><h2>{name}</h2><div className="pair"><div><h3>Source through product Viewer</h3><Viewer src={source} name={`${name} source`} interactive expectedDimensions={product.dimensions} materialOverrides={variant.materialOverrides}/></div><div><h3>Export through layout Viewer</h3><Viewer src={exported} name={`${name} layout`} interactive expectedDimensions={dimensions}/></div></div></>);
}
async function cases() {
  const catalog=await (await fetch('/models/catalog/catalog.json')).json();
  const chair=catalog.models.find((entry:any)=>entry.id==='blue-granite-hand-chair');
  const lamp:FurnitureProduct={id:'qa-lamp',name:'Ambimall lamp',category:'Lighting',tagline:'QA',description:'QA',material:'Beige and black',background:'#eee9df',dimensions:{width:.5319242,height:1.524,depth:.4306782},variants:[{id:'original',name:'Original',color:'#c8b99f',modelSrc:'/models/ambimall-floor-lamp.glb'}]};
  const chairProduct:FurnitureProduct={id:chair.id,name:'Blue granite hand chair',category:'Seating',tagline:'QA',description:'QA',material:'Blue granite',background:'#eee9df',dimensions:chair.dimensionsMeters,variants:[{id:'original',name:'Original',color:'#365d8f',modelSrc:chair.modelSrc}]};
  const coloredFixture:FurnitureProduct={id:'qa-vertex-color-fixture',name:'Authored vertex-color test cube',category:'Seating',tagline:'Test fixture',description:'Synthetic fixture, not an Amazon product',material:'Per-vertex colors',background:'#eee9df',dimensions:{width:1,height:1,depth:1},variants:[{id:'original',name:'Original',color:'#3266bb',modelSrc:'/tests/browser/fixtures/vertex-colors.glb'}]};
  return [
    {name:'Oak table with original wood textures',product:placeholderProduct,variant:placeholderProduct.variants[0]},
    {name:'Table with intentional black finish',product:placeholderProduct,variant:placeholderProduct.variants.find(value=>value.id==='black')!},
    {name:'Beige and black lamp',product:lamp,variant:lamp.variants[0]},
    {name:'Blue textured catalog chair',product:chairProduct,variant:chairProduct.variants[0]},
    {name:'Authored vertex-color fixture',product:coloredFixture,variant:coloredFixture.variants[0]},
  ];
}

async function run() {
  report.textContent='';for(const root of roots)root.unmount();roots.length=0;previews.replaceChildren();status.textContent='Running browser texture checks…';status.className='';
  for(const url of urls)URL.revokeObjectURL(url);urls.length=0;
  let failures=0;
  const entries=await cases();
  for(const entry of entries){
    try{
      const source=glb(await (await fetch(entry.variant.modelSrc)).arrayBuffer());
      const sourceMaterials=materials(source);
      const loaded=await new GLTFLoader().parseAsync(source.bytes,entry.variant.modelSrc.startsWith('blob:')?'':new URL('.',new URL(entry.variant.modelSrc,location.href)).href);
      const loadedMaps:Array<{name:string;map:boolean;normalMap:boolean;vertexColors:boolean;image:string}>=[];
      loaded.scene.traverse(node=>{const mesh=node as Mesh;if(!mesh.isMesh)return;for(const candidate of Array.isArray(mesh.material)?mesh.material:[mesh.material]){const m=candidate as Material&{map?:Texture;normalMap?:Texture;vertexColors?:boolean};loadedMaps.push({name:m.name,map:!!m.map,normalMap:!!m.normalMap,vertexColors:!!m.vertexColors,image:m.map?.image?.constructor?.name??''});}});
      const exported=await exportLayout(layout(entry.product,entry.variant));urls.push(exported.url);
      view(entry.name,entry.variant.modelSrc,exported.url,entry.product,entry.variant,exported.dimensions);
      const target=glb(await (await fetch(exported.url)).arrayBuffer());
      const targetMaterials=materials(target);
      log({case:entry.name,sourceMaterials,loadedMaps,exportedMaterials:targetMaterials,exportedImages:target.json.images?.length??0});
      for(const material of sourceMaterials){
        const override=entry.variant.materialOverrides?.find(value=>value.materialName===material.name);
        const matches=targetMaterials.filter((candidate:any)=>candidate.name===material.name);
        assert(matches.length>0,`${material.name}: material vanished`);
        for(const match of matches){
          if(override){assert(match.baseColorTexture===null,`${material.name}: solid finish must remove albedo texture`);assert(match.factor.some((value:number,index:number)=>index<3&&value<.1),`${material.name}: black finish became white`);continue;}
          assert(JSON.stringify(match.factor)===JSON.stringify(material.factor),`${material.name}: base color factor changed`);
          if(material.baseColorTexture!==null){
            assert(loadedMaps.some(value=>value.name===material.name&&value.map),`${material.name}: loader dropped source albedo map`);
            assert(match.baseColorTexture!==null,`${material.name}: export dropped source albedo map`);
            const before=await texturePixels(source,material.baseColorTexture),after=await texturePixels(target,match.baseColorTexture);
            log({material:material.name,sourcePixels:before,exportedPixels:after});
            assert(before.mean.every((value:number,index:number)=>Math.abs(value-after.mean[index])<8),`${material.name}: exported texture pixels changed`);
          }
          if(material.normalTexture!==null)assert(match.normalTexture!==null,`${material.name}: normal texture lost`);
        }
      }
      const sourceColors=vertexColors(source),targetColors=vertexColors(target);
      if(sourceColors.length){
        assert(sourceColors.length===targetColors.length,'GLB lost vertex-color attribute values');
        assert(sourceColors.every((value,index)=>Math.abs(value-targetColors[index])<1e-6),'GLB changed vertex colors');
        log({case:entry.name,vertexColorComponents:sourceColors.length,vertexColorsPreserved:true});
      }
      await checkUsdz(target,entry.name);
      log(`PASS: ${entry.name}`);
    }catch(error){failures++;log(`FAIL: ${entry.name}: ${(error as Error).message}`);}
  }
  status.textContent=failures?`FAIL: ${failures} of ${entries.length} texture round-trip cases failed.`:`PASS: all ${entries.length} texture round-trip cases passed.`;
  status.className=failures?'fail':'pass';
}
async function textureFallback() {
  report.textContent='';status.textContent='Testing HTML-image fallback…';status.className='';
  const original=window.createImageBitmap,cacheEnabled=Cache.enabled;
  let result:Awaited<ReturnType<typeof exportLayout>>|undefined;
  try{
    Cache.enabled=false;
    window.createImageBitmap=(async()=>{throw new Error('Intentional QA image decoding failure');}) as typeof createImageBitmap;
    result=await exportLayout(layout(placeholderProduct,placeholderProduct.variants[0]));urls.push(result.url);
  }finally{window.createImageBitmap=original;Cache.enabled=cacheEnabled;}
  assert(result,'Fallback produced no layout');
  const source=glb(await (await fetch(placeholderProduct.variants[0].modelSrc)).arrayBuffer());
  const target=glb(await (await fetch(result!.url)).arrayBuffer());
  for(const sourceMaterial of materials(source)){
    const targetMaterial=materials(target).find((value:any)=>value.name===sourceMaterial.name);
    assert(targetMaterial,`${sourceMaterial.name}: fallback lost material`);
    if(sourceMaterial.baseColorTexture!==null){
      assert(targetMaterial.baseColorTexture!==null,`${sourceMaterial.name}: fallback lost albedo map`);
      const before=await texturePixels(source,sourceMaterial.baseColorTexture),after=await texturePixels(target,targetMaterial.baseColorTexture);
      log({material:sourceMaterial.name,sourcePixels:before,fallbackPixels:after});
      assert(before.mean.every((value,index)=>Math.abs(value-after.mean[index])<8),'Fallback changed texture pixels');
    }
    if(sourceMaterial.normalTexture!==null)assert(targetMaterial.normalTexture!==null,'Fallback lost normal map');
  }
  view('ImageBitmap failure recovered with original wood textures',placeholderProduct.variants[0].modelSrc,result!.url,placeholderProduct,placeholderProduct.variants[0],result!.dimensions);
  status.textContent='PASS: fallback retained the original texture pixels and material maps.';status.className='pass';
}
async function missingTexture() {
  report.textContent='';status.textContent='Testing complete decoder failure…';status.className='';
  const original=window.createImageBitmap,cacheEnabled=Cache.enabled;
  const src=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src')!;
  try{
    Cache.enabled=false;
    window.createImageBitmap=(async()=>{throw new Error('Intentional QA image decoding failure');}) as typeof createImageBitmap;
    Object.defineProperty(HTMLImageElement.prototype,'src',{...src,set(value:string){src.set!.call(this,value.startsWith('blob:')?'data:image/png;base64,invalid-qa-image':value);}});
    try{
      const result=await exportLayout(layout(placeholderProduct,placeholderProduct.variants[0]));urls.push(result.url);
      status.textContent='FAIL: failed decoders produced a colorless layout instead of an error.';status.className='fail';
    }catch(error){status.textContent='PASS: complete texture decoder failure stopped layout export.';status.className='pass';log((error as Error).message);}
  }
  finally{window.createImageBitmap=original;Cache.enabled=cacheEnabled;Object.defineProperty(HTMLImageElement.prototype,'src',src);}
}
document.querySelector<HTMLButtonElement>('#run')!.onclick=()=>{void locked(run);};
document.querySelector<HTMLButtonElement>('#fallback-textures')!.onclick=()=>{void locked(textureFallback);};
document.querySelector<HTMLButtonElement>('#fail-textures')!.onclick=()=>{void locked(missingTexture);};
