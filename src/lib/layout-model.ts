import { Box3, Group, Scene, Vector3 } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { dimensionsMatch, getVariant } from './products';
import { cloneModelMaterials, createThreeColorController } from './material-colors';
import { modelResourcePath, parseModelWithTextures } from './model-loader';
import type { RoomLayout, PlacedItem } from './workspace';

/** Coordinates match the floor plan: x is right, z is down toward the viewer.
 * SVG clockwise rotation becomes negative rotation around Three.js's +Y axis. */
export function arrangeModels(items:PlacedItem[],models:Map<string,Group>):Scene {
  const scene=new Scene();
  for(const item of items){
    if(!item.product)throw new Error('Every piece needs a matching 3D model before this layout can be previewed.');
    const variant=getVariant(item.product,item.variantId);
    const source=models.get(variant.modelSrc);
    if(!source)throw new Error(`The model for ${item.name} is missing.`);
    const object=cloneModelMaterials(source);
    createThreeColorController(object).apply(variant.materialOverrides);
    object.position.set(item.x,item.elevation??0,item.z);
    object.rotation.y=-item.rotation*Math.PI/180;
    object.name=item.name;
    scene.add(object);
  }
  return scene;
}
async function loadLayoutScene(layout:RoomLayout, signal?:AbortSignal):Promise<Scene> {
  if(!layout.items.length)throw new Error('Add a piece before opening the 3D preview.');
  if(layout.items.some(item=>!item.product))throw new Error('Every piece needs a matching 3D model before this layout can be previewed.');
  const models=new Map<string,Group>();
  const assets=new Map(layout.items.map(item=>[getVariant(item.product,item.variantId).modelSrc,item.product]));
  for(const [src,product] of assets){
    const response=await fetch(src,{signal});
    if(!response.ok)throw new Error('A model couldn’t load. Please try again.');
    const model=await parseModelWithTextures(await response.arrayBuffer(),modelResourcePath(src,window.location.href),signal);
    const bounds=new Box3().setFromObject(model.scene,true).getSize(new Vector3());
    if(!dimensionsMatch(bounds,product.dimensions))throw new Error('A model has incorrect dimensions. Fix its scale before placing the layout in AR.');
    models.set(src,model.scene);
  }
  signal?.throwIfAborted();
  const scene=arrangeModels(layout.items,models);
  scene.updateMatrixWorld(true);
  return scene;
}
export async function exportLayout(layout:RoomLayout, signal?:AbortSignal):Promise<{url:string;dimensions:{width:number;height:number;depth:number}}> {
  const scene=await loadLayoutScene(layout,signal);
  const bounds=new Box3().setFromObject(scene,true).getSize(new Vector3());
  const result=await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:true});
  signal?.throwIfAborted();
  return {url:URL.createObjectURL(new Blob([result as ArrayBuffer],{type:'model/gltf-binary'})),dimensions:{width:bounds.x,height:bounds.y,depth:bounds.z}};
}
/** Retain the floor-plan origin. Plane anchoring/centering belongs to native AR. */
export async function exportNativeLayout(layout:RoomLayout, signal?:AbortSignal):Promise<Uint8Array> {
  const scene=await loadLayoutScene(layout,signal);
  const {USDZExporter}=await import('./quick-look-model');
  const result=await new USDZExporter().parseAsync(scene,{includeAnchoringProperties:false});
  signal?.throwIfAborted();
  if(result.byteLength>48*1024*1024)throw new Error('This arrangement is too large for the app preview. Try fewer pieces.');
  return result;
}
