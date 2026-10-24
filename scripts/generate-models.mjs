import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Exporter uses FileReader even for untextured meshes. This adapter keeps asset
// generation deterministic and entirely local; runtime browsers need no shim.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); });
  }
};
const catalog = JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
const exporter = new GLTFExporter();
await mkdir(new URL('../public/models/', import.meta.url), { recursive: true });
const material = (color, roughness = 0.88, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
function mesh(parent, geometry, mat, x, y, z) {
  const item = new THREE.Mesh(geometry, mat); item.position.set(x, y, z); parent.add(item); return item;
}
function box(parent, size, pos, mat, radius = .025) {
  return mesh(parent, new RoundedBoxGeometry(...size, 3, radius), mat, ...pos);
}
function cylinder(parent, top, bottom, height, pos, mat) {
  return mesh(parent, new THREE.CylinderGeometry(top, bottom, height, 48), mat, ...pos);
}
function build(product, variant) {
  const group = new THREE.Group();
  group.name = `${product.name} — ${variant.name}`;
  const fabric = material(variant.color), wood = material('#79553a', .64), dark = material('#353932', .52, .3);
  if (product.kind === 'chair' || product.kind === 'sofa') {
    const sofa = product.kind === 'sofa';
    const w = sofa ? 1.86 : .78, d = sofa ? .9 : .82;
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      cylinder(group, .036, .026, .20, [x * (w / 2 - .10), .10, z * (d / 2 - .10)], wood);
    }
    box(group, [w-.08,.18,d-.07], [0,.25,0], fabric, .065);
    const count = sofa ? 2 : 1;
    const seatWidth = (w-.26) / count;
    for (let i=0; i<count; i++) {
      const x = -((w-.26)/2) + seatWidth * (i+.5);
      box(group, [seatWidth-.008,.15,d-.22], [x,.39,.055], fabric, .065);
      const back = box(group, [seatWidth-.008,.42,.18], [x,.59,-d/2+.13], fabric, .075);
      back.rotation.x = -.10;
    }
    for (const x of [-1,1]) box(group, [.13,.34,d-.04], [x*(w/2-.065),.48,.015], fabric, .060);
  } else if (product.kind === 'table') {
    cylinder(group, .45, .45, .065, [0,.3475,0], fabric);
    box(group,[.64,.315,.075],[0,.1575,0],fabric,.016);
    box(group,[.075,.315,.64],[0,.1575,0],fabric,.016);
  } else if (product.kind === 'lamp') {
    cylinder(group,.155,.16,.035,[0,.0175,0],dark);
    cylinder(group,.012,.012,1.22,[0,.63,0],dark);
    const shade = new THREE.MeshStandardMaterial({color:variant.color,roughness:1,side:THREE.DoubleSide});
    mesh(group,new THREE.CylinderGeometry(.14,.21,.29,64,1,true),shade,0,1.375,0);
    cylinder(group,.035,.035,.08,[0,1.24,0],wood);
  } else if (product.kind === 'sideboard') {
    for(const x of [-.6,.6]) for(const z of [-.14,.14]) box(group,[.035,.18,.035],[x,.09,z],dark,.005);
    box(group,[1.4,.57,.40],[0,.465,0],fabric,.012);
    const panelMaterial=material(new THREE.Color(variant.color).multiplyScalar(.91));
    for(let i=0;i<3;i++) {
      box(group,[.448,.49,.022],[(i-1)*.46,.46,.20],panelMaterial,.006);
      box(group,[.11,.012,.017],[(i-1)*.46,.60,.22],dark,.004);
    }
  } else {
    cylinder(group,.235,.235,.065,[0,.0325,0],wood);
    box(group,[.60,.355,.60],[0,.2425,0],fabric,.15);
  }
  // Bake exact catalog dimensions into geometry. glTF uses meters; the floor
  // is y=0 and the object's front points +Z. Never depend on CSS/viewer scale.
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group, true);
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const scale = new THREE.Vector3(product.dimensions.width/size.x, product.dimensions.height/size.y, product.dimensions.depth/size.z);
  const transform = new THREE.Matrix4().makeScale(scale.x,scale.y,scale.z)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x,-bounds.min.y,-center.z));
  const baked = new THREE.Group(); baked.name = group.name;
  for(const child of group.children) {
    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld); geometry.applyMatrix4(transform);
    baked.add(new THREE.Mesh(geometry,child.material));
  }
  baked.userData={dimensionsMeters:product.dimensions,license:'CC0-1.0',sample:true};
  return baked;
}
let count=0;
for(const product of catalog) for(const variant of product.variants) {
  const scene=new THREE.Scene(); scene.add(build(product,variant));
  const result=await exporter.parseAsync(scene,{binary:true,onlyVisible:true});
  await writeFile(new URL(`../public${variant.modelSrc}`,import.meta.url),Buffer.from(result)); count++;
}
console.log(`Generated ${count} furniture GLBs with dimensions baked in meters.`);
