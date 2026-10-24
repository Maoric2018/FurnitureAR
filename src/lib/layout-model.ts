import { Box3, Group, Scene, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { dimensionsMatch } from './products';
import type { RoomLayout, PlacedItem } from './workspace';

/** Coordinates match the floor plan: x is right, z is down toward the viewer.
 * SVG clockwise rotation becomes negative rotation around Three.js's +Y axis. */
export function arrangeModels(items:PlacedItem[],models:Map<string,Group>):Scene {
  const scene=new Scene();
  for(const item of items){
    const source=models.get(item.product.variants[0].modelSrc);
    if(!source)throw new Error(`The model for ${item.name} is missing.`);
    const object=source.clone(true);
    object.position.set(item.x,0,item.z);
    object.rotation.y=-item.rotation*Math.PI/180;
    object.name=item.name;
    scene.add(object);
  }
  return scene;
}
export async function exportLayout(layout:RoomLayout, signal?:AbortSignal):Promise<{url:string;dimensions:{width:number;height:number;depth:number}}> {
  if(!layout.items.length)throw new Error('Add a piece before opening the 3D preview.');
  const models=new Map<string,Group>(),loader=new GLTFLoader();
  const assets=new Map(layout.items.map(item=>[item.product.variants[0].modelSrc,item.product]));
  for(const [src,product] of assets){
    const response=await fetch(src,{signal});
    if(!response.ok)throw new Error('A model couldn’t load. Please try again.');
    const model=await loader.parseAsync(await response.arrayBuffer(),new URL('.',new URL(src,window.location.href)).href);
    const bounds=new Box3().setFromObject(model.scene,true).getSize(new Vector3());
    if(!dimensionsMatch(bounds,product.dimensions))throw new Error('A model has incorrect dimensions. Fix its scale before placing the layout in AR.');
    models.set(src,model.scene);
  }
  signal?.throwIfAborted();
  const scene=arrangeModels(layout.items,models);
  const bounds=new Box3().setFromObject(scene,true).getSize(new Vector3());
  const result=await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:true});
  signal?.throwIfAborted();
  return {url:URL.createObjectURL(new Blob([result as ArrayBuffer],{type:'model/gltf-binary'})),dimensions:{width:bounds.x,height:bounds.y,depth:bounds.z}};
}
