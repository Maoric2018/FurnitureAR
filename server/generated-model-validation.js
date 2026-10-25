const MAX_GLB_BYTES = 25 * 1024 * 1024;

// Validate the GLB container before making it a public model. This catches
// truncation, non-GLB responses and models that depend on external asset URLs.
// A future provider remains responsible for valid geometry and its true scale.
export function validateGeneratedModel(result) {
  const bytes = result?.glb;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 20 || bytes.byteLength > MAX_GLB_BYTES) throw new Error('Invalid GLB size.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) throw new Error('Invalid GLB header.');
  let offset = 12, doc, binaryLength = null, chunks = 0;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw new Error('Truncated GLB chunk.');
    const length = view.getUint32(offset, true), kind = view.getUint32(offset + 4, true);
    offset += 8;
    if (length % 4 || offset + length > bytes.byteLength) throw new Error('Invalid GLB chunk.');
    if (chunks === 0 && kind === 0x4e4f534a) {
      doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + length)));
    } else if (chunks === 1 && kind === 0x004e4942) binaryLength = length;
    else throw new Error('Unsupported GLB chunk.');
    offset += length; chunks++;
  }
  if (doc?.asset?.version !== '2.0' || !Array.isArray(doc.meshes) || !doc.meshes.length
      || !Array.isArray(doc.scenes) || !doc.scenes.length) throw new Error('GLB has no scene geometry.');
  const embedded = value => typeof value === 'string' && /^data:[a-z0-9.+\-/]+;base64,[a-z0-9+/]*={0,2}$/i.test(value);
  if (doc.buffers !== undefined && !Array.isArray(doc.buffers)) throw new Error('Invalid GLB buffers.');
  for (const [index, buffer] of (doc.buffers ?? []).entries()) {
    if (!Number.isInteger(buffer.byteLength) || buffer.byteLength <= 0) throw new Error('Invalid GLB buffer.');
    if (buffer.uri !== undefined) { if (!embedded(buffer.uri)) throw new Error('External GLB buffer.'); }
    else if (index !== 0 || binaryLength === null || buffer.byteLength > binaryLength || binaryLength - buffer.byteLength > 3) throw new Error('Missing GLB buffer.');
  }
  if (doc.images !== undefined && !Array.isArray(doc.images)) throw new Error('Invalid GLB images.');
  for (const image of doc.images ?? []) {
    if (image.uri !== undefined) { if (!embedded(image.uri)) throw new Error('External GLB image.'); }
    else if (!Number.isInteger(image.bufferView) || !doc.bufferViews?.[image.bufferView]) throw new Error('Missing embedded image.');
  }
  if (!result.dimensions || !['width', 'height', 'depth'].every(name => Number.isFinite(result.dimensions[name]) && result.dimensions[name] > 0 && result.dimensions[name] <= 20)) throw new Error('Invalid model dimensions.');
  return bytes;
}
