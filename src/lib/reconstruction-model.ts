import { Box3, Group, Mesh, Texture, Vector3 } from 'three';
import type { Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
export interface PreparedModel { url: string; dimensions: { width: number; height: number; depth: number } }
export function checkEmbeddedGlb(buffer: ArrayBuffer) {
  if (buffer.byteLength < 20 || buffer.byteLength > 25 * 1024 * 1024) throw new Error('The returned model is empty or too large to preview.');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength
    || view.getUint32(16, true) !== 0x4e4f534a || view.getUint32(12, true) > buffer.byteLength - 20) throw new Error('The service did not return a valid GLB model.');
  let model;
  try { model = JSON.parse(new TextDecoder().decode(buffer.slice(20, 20 + view.getUint32(12, true)))); } catch { throw new Error('The model data could not be read.'); }
  if (model.asset?.version !== '2.0' || !Array.isArray(model.meshes) || !model.meshes.length) throw new Error('This result does not contain a 3D mesh.');
  for (const asset of [...(model.buffers || []), ...(model.images || [])]) {
    if (asset.uri && !/^data:(image\/(png|jpeg|webp)|application\/octet-stream);base64,/.test(asset.uri)) throw new Error('The model must include its textures and geometry in one file.');
  }
}
export function normalizeGeneratedScene(source: Object3D, heightMeters: number) {
  if (!Number.isFinite(heightMeters) || heightMeters < .05 || heightMeters > 5) throw new Error('Enter a height between 5 and 500 cm.');
  let vertices = 0;
  source.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute('position');
    if (!position) throw new Error('This model is missing its geometry.');
    vertices += position.count;
    if (vertices > 2_000_000) throw new Error('This model is too detailed for the mobile preview.');
    for (let i = 0; i < position.count; i++) if (![position.getX(i), position.getY(i), position.getZ(i)].every(Number.isFinite)) throw new Error('This model contains invalid geometry. Try generating it again.');
  });
  const bounds = new Box3().setFromObject(source, true), size = bounds.getSize(new Vector3());
  if (!vertices || ![size.x, size.y, size.z].every(n => Number.isFinite(n) && n > .000001)) throw new Error('This model has no usable volume. Try another photo.');
  const factor = heightMeters / size.y, center = bounds.getCenter(new Vector3());
  const group = new Group(); group.add(source); group.scale.setScalar(factor);
  group.position.set(-center.x * factor, -bounds.min.y * factor, -center.z * factor);
  return { scene: group, dimensions: { width: size.x * factor, height: heightMeters, depth: size.z * factor } };
}
export async function prepareGeneratedModel(buffer: ArrayBuffer, heightMeters: number, signal?: AbortSignal): Promise<PreparedModel> {
  checkEmbeddedGlb(buffer); signal?.throwIfAborted();
  const model = await new GLTFLoader().parseAsync(buffer, '');
  try {
    signal?.throwIfAborted();
    const { scene, dimensions } = normalizeGeneratedScene(model.scene, heightMeters);
    const output = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true });
    signal?.throwIfAborted();
    return { url: URL.createObjectURL(new Blob([output as ArrayBuffer], { type: 'model/gltf-binary' })), dimensions };
  } finally {
    model.scene.traverse(object => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof Texture) { value.dispose(); value.source?.data?.close?.(); }
        material.dispose();
      }
    });
  }
}
