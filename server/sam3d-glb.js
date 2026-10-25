import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { validateGeneratedModel } from './generated-model-validation.js';

/** Normalize the Pod's static mesh without decoding textures or rewriting its
 * binary attributes. Actual vertices determine bounds, not accessor min/max.
 * A root transform preserves materials, normals and reconstructed proportions.
 */
export function normalizeSamGlb(bytes, listedDimensions) {
  validateGeneratedModel({ glb: bytes, dimensions: { width: 1, height: 1, depth: 1 } });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const binaryStart = 28 + jsonLength;
  const binaryLength = binaryStart <= bytes.length ? view.getUint32(binaryStart - 8, true) : 0;
  if (!binaryLength || doc.buffers?.length !== 1 || doc.buffers[0].uri
    || doc.animations?.length || doc.skins?.length || doc.extensionsRequired?.length
    || !Array.isArray(doc.nodes) || doc.nodes.length > 10000) throw new Error('Unsupported SAM mesh.');
  const scene = doc.scenes[doc.scene ?? 0];
  if (!Array.isArray(scene?.nodes) || !scene.nodes.length) throw new Error('Empty SAM scene.');
  const bounds = new Box3(), point = new Vector3(), visited = new Set();
  let vertices = 0;
  const vector = (value, length, fallback) => {
    const result = value ?? fallback;
    if (!Array.isArray(result) || result.length !== length || !result.every(Number.isFinite)) throw new Error('Invalid node transform.');
    return result;
  };
  const walk = (index, parent, depth = 0) => {
    if (!Number.isInteger(index) || !doc.nodes[index] || visited.has(index) || depth > 100) throw new Error('Invalid scene tree.');
    visited.add(index);
    const node = doc.nodes[index], local = new Matrix4();
    if (node.skin !== undefined || node.weights || node.extensions) throw new Error('Unsupported node geometry.');
    if (node.matrix) local.fromArray(vector(node.matrix, 16));
    else local.compose(new Vector3().fromArray(vector(node.translation,3,[0,0,0])),
      new Quaternion().fromArray(vector(node.rotation,4,[0,0,0,1])), new Vector3().fromArray(vector(node.scale,3,[1,1,1])));
    const matrix = new Matrix4().multiplyMatrices(parent, local);
    if (node.mesh !== undefined) {
      const mesh = doc.meshes[node.mesh];
      if (!Array.isArray(mesh?.primitives) || !mesh.primitives.length || mesh.weights) throw new Error('Invalid mesh.');
      for (const primitive of mesh.primitives) {
        if (primitive.targets || primitive.extensions || (primitive.mode !== undefined && primitive.mode !== 4)) throw new Error('Unsupported mesh primitive.');
        const accessor = doc.accessors?.[primitive.attributes?.POSITION];
        const buffer = doc.bufferViews?.[accessor?.bufferView];
        if (!accessor || accessor.type !== 'VEC3' || accessor.componentType !== 5126 || accessor.normalized || accessor.sparse
          || !buffer || buffer.buffer !== 0 || !Number.isInteger(accessor.count) || accessor.count <= 0
          || (vertices += accessor.count) > 2_000_000) throw new Error('Invalid vertex data.');
        const offset = accessor.byteOffset ?? 0, base = buffer.byteOffset ?? 0, stride = buffer.byteStride ?? 12;
        if (![offset,base,stride,buffer.byteLength].every(Number.isInteger) || offset < 0 || base < 0
          || stride < 12 || stride > 252 || stride % 4 || (base + offset) % 4
          || offset + (accessor.count - 1) * stride + 12 > buffer.byteLength
          || base + buffer.byteLength > doc.buffers[0].byteLength) throw new Error('Vertex buffer out of bounds.');
        for (let i = 0; i < accessor.count; i++) {
          const at = binaryStart + base + offset + i * stride;
          point.set(view.getFloat32(at,true),view.getFloat32(at+4,true),view.getFloat32(at+8,true)).applyMatrix4(matrix);
          if (![point.x,point.y,point.z].every(Number.isFinite)) throw new Error('Nonfinite geometry.');
          bounds.expandByPoint(point);
        }
      }
    }
    if (node.children !== undefined && !Array.isArray(node.children)) throw new Error('Invalid node children.');
    for (const child of node.children ?? []) walk(child, matrix, depth + 1);
  };
  for (const node of scene.nodes) walk(node, new Matrix4());
  const size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
  if (!vertices || ![size.x,size.y,size.z].every(n => Number.isFinite(n) && n > 1e-6)) throw new Error('Empty model volume.');
  const reference = ['height','width','depth'].find(key => Number.isFinite(listedDimensions?.[key]) && listedDimensions[key] >= .01 && listedDimensions[key] <= 20);
  const axis = { height: 'y', width: 'x', depth: 'z' };
  const factor = reference ? listedDimensions[reference] / size[axis[reference]] : 1 / size.y;
  const dimensions = { width: size.x * factor, height: size.y * factor, depth: size.z * factor };
  const root = doc.nodes.length;
  doc.nodes.push({ name: 'Furniture AR metric origin', children: scene.nodes,
    scale: [factor,factor,factor], translation: [-center.x*factor,-bounds.min.y*factor,-center.z*factor] });
  doc.scene = 0; doc.scenes = [{ ...scene, nodes: [root] }];
  const json = new TextEncoder().encode(JSON.stringify(doc)), padded = Math.ceil(json.length/4)*4;
  const glb = new Uint8Array(28 + padded + binaryLength), output = new DataView(glb.buffer);
  output.setUint32(0,0x46546c67,true); output.setUint32(4,2,true); output.setUint32(8,glb.length,true);
  output.setUint32(12,padded,true); output.setUint32(16,0x4e4f534a,true);
  glb.fill(32,20,20+padded); glb.set(json,20);
  output.setUint32(20+padded,binaryLength,true); output.setUint32(24+padded,0x004e4942,true);
  glb.set(bytes.subarray(binaryStart,binaryStart+binaryLength),28+padded);
  validateGeneratedModel({ glb, dimensions });
  return { glb, dimensions, scaleReference: reference ?? 'preview' };
}
