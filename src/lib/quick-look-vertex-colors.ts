import type { BufferGeometry, Material, Mesh, Object3D } from 'three';
import type { MeshStandardMaterial } from 'three';
import { strToU8, zlibSync } from 'three/addons/libs/fflate.module.js';

type Files = Record<string, Uint8Array<ArrayBuffer>>;
// Three's runtime exporter uses the numeric id; its public typings omit it.
type ColoredMaterial = MeshStandardMaterial & { id: number };
interface ColoredGeometry { geometry: BufferGeometry; materials: Map<number, ColoredMaterial> }
interface Tile { colors: number[]; large: boolean; x: number; y: number }
const MAX_ATLAS = 4096;
const UV_NAME = 'vertexColorUV';
const decoder = new TextDecoder();
const fail = (message: string): never => { throw new Error(`This model’s AR colors could not be prepared: ${message}`); };

/** The upstream exporter writes displayColor, but does not connect it to the
 * surface shader. Quick Look can consequently render a colored mesh white.
 * Read the source without changing it; the conversion below edits USD only. */
export function collectVertexColorGeometry(scene: Object3D, onlyVisible = true) {
  const result = new Map<number, ColoredGeometry>();
  const visit = (object: Object3D) => {
    if (onlyVisible && !object.visible) return;
    const mesh = object as Mesh;
    if (mesh.isMesh && mesh.geometry.getAttribute('color')) {
      const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const colors = mesh.geometry.getAttribute('color');
      const hasImage = materials.some(material => (material as ColoredMaterial).map || (material as ColoredMaterial).alphaMap);
      let neutral = hasImage;
      if (neutral) for (let i = 0; i < colors.count; i++) {
        if (colors.getX(i) !== 1 || colors.getY(i) !== 1 || colors.getZ(i) !== 1 || (colors.itemSize === 4 && colors.getW(i) !== 1)) { neutral = false; break; }
      }
      // Multiplying an existing texture by white changes nothing. Other
      // texture/vertex-color combinations require a separate texture rebake.
      if (!neutral && materials.some(material => material.vertexColors)) {
        if (materials.length !== 1) fail('vertex colors with multiple materials are not supported yet.');
        const material = materials[0] as ColoredMaterial;
        if (!material.isMeshStandardMaterial) fail('the vertex-color material is unsupported.');
        if (material.map) fail('combined image textures and vertex colors need a texture bake before opening AR.');
        if (material.alphaMap) fail('combined opacity textures and vertex colors need a texture bake before opening AR.');
        let entry = result.get(mesh.geometry.id);
        if (!entry) { entry = { geometry: mesh.geometry, materials: new Map() }; result.set(mesh.geometry.id, entry); }
        entry.materials.set(material.id, material);
      }
    }
    for (const child of object.children) visit(child);
  };
  visit(scene);
  return result;
}

const channel = (color: number, index: number) => (color >>> (index * 8)) & 255;
const powerOfTwo = (value: number) => 2 ** Math.ceil(Math.log2(Math.max(value, 1)));
function packColor(values: number[]) {
  let result = 0;
  for (let i = 0; i < 4; i++) {
    const value = values[i];
    if (!Number.isFinite(value) || value < 0 || value > 1) fail('a vertex color is outside the supported range.');
    result += Math.round(value * 255) * 2 ** (i * 8);
  }
  return result >>> 0;
}

function makeAtlas(geometry: BufferGeometry) {
  const colors = geometry.getAttribute('color');
  const positions = geometry.getAttribute('position');
  if (!positions || colors.count !== positions.count || (colors.itemSize !== 3 && colors.itemSize !== 4)) fail('vertex colors do not match the mesh.');
  const packed = new Uint32Array(colors.count);
  let hasAlpha = false;
  for (let i = 0; i < colors.count; i++) {
    packed[i] = packColor([colors.getX(i), colors.getY(i), colors.getZ(i), colors.itemSize === 4 ? colors.getW(i) : 1]);
    hasAlpha ||= channel(packed[i], 3) !== 255;
  }
  const indices = geometry.getIndex();
  const count = indices?.count ?? positions.count;
  if (!count || count % 3) fail('the mesh is not a triangle mesh.');
  const vertex = (i: number) => {
    const index = indices ? indices.getX(i) : i;
    if (!Number.isInteger(index) || index < 0 || index >= packed.length) fail('the mesh has invalid vertex indices.');
    return packed[index];
  };
  const unique = new Map<string, number>();
  const tiles: Tile[] = [];
  const faceTiles = new Uint32Array(count / 3);
  let largeCount = 0;
  for (let face = 0; face < faceTiles.length; face++) {
    const triple = [vertex(face * 3), vertex(face * 3 + 1), vertex(face * 3 + 2)].sort((a, b) => a - b);
    const key = triple.join(':');
    let id = unique.get(key);
    if (id === undefined) {
      // A bilinear patch reproduces an affine triangle gradient when its
      // fourth corner is B+C-A. Choose A to avoid clipping that extrapolation.
      let origin = -1;
      for (let candidate = 0; candidate < 3; candidate++) {
        if ([0, 1, 2, 3].every(c => {
          const fourth = channel(triple[(candidate + 1) % 3], c) + channel(triple[(candidate + 2) % 3], c) - channel(triple[candidate], c);
          return fourth >= 0 && fourth <= 255;
        })) { origin = candidate; break; }
      }
      const large = origin < 0;
      if (large) { origin = 0; largeCount++; }
      const ordered = [triple[origin], triple[(origin + 1) % 3], triple[(origin + 2) % 3]];
      id = tiles.length;
      tiles.push({ colors: ordered, large, x: 0, y: 0 });
      unique.set(key, id);
      // Include padding and stop before allocating unbounded texture memory.
      if ((tiles.length - largeCount) * 36 + largeCount * 144 > 4092 * 4092) fail('this mesh needs a smaller, textured model for phone AR.');
    }
    faceTiles[face] = id;
  }
  unique.clear();
  const smallCount = tiles.length - largeCount;
  const area = smallCount * 36 + largeCount * 144;
  let width = Math.min(4092, Math.max(12, Math.ceil(Math.sqrt(area) / 12) * 12));
  const heightFor = (w: number) => Math.ceil(largeCount / Math.floor(w / 12)) * 12 + Math.ceil(smallCount / Math.floor(w / 6)) * 6;
  while (heightFor(width) > 4092 && width < 4092) width += 12;
  if (heightFor(width) > 4092) fail('this mesh needs a smaller, textured model for phone AR.');
  const largeRows = Math.ceil(largeCount / Math.floor(width / 12));
  let small = 0, large = 0;
  for (const tile of tiles) {
    const size = tile.large ? 12 : 6;
    const index = tile.large ? large++ : small++;
    const columns = Math.floor(width / size);
    tile.x = (index % columns) * size;
    tile.y = Math.floor(index / columns) * size + (tile.large ? 0 : largeRows * 12);
  }
  const height = powerOfTwo(heightFor(width));
  width = powerOfTwo(width);
  if (width > MAX_ATLAS || height > MAX_ATLAS) fail('the color texture exceeds the phone AR limit.');
  // PNG scanlines include a zero filter byte. Write directly into them rather
  // than holding a second full-size canvas/image alongside the export.
  const stride = width * 4 + 1;
  const pixels = new Uint8Array(stride * height);
  for (const tile of tiles) {
    const size = tile.large ? 12 : 6, span = size - 3;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = Math.max(0, Math.min(1, (x - 1) / span));
      const v = Math.max(0, Math.min(1, (y - 1) / span));
      const offset = (tile.y + y) * stride + 1 + (tile.x + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = channel(tile.colors[0], c), b = channel(tile.colors[1], c), d = channel(tile.colors[2], c);
        pixels[offset + c] = Math.round(Math.max(0, Math.min(255, a + (b - a) * u + (d - a) * v)));
      }
    }
  }
  // The data is linear, like glTF COLOR_0. sourceColorSpace=raw keeps Quick
  // Look from applying a second sRGB decode. High-contrast patches use a
  // nine-texel span: clipping outside their triangle can introduce at most
  // ~0.028 linear interpolation error, plus 8-bit rounding, at its diagonal.
  const png = encodePng(width, height, pixels);
  const chunks: string[] = [];
  let chunk: string[] = [];
  for (let face = 0; face < faceTiles.length; face++) {
    const tile = tiles[faceTiles[face]], span = (tile.large ? 12 : 6) - 3;
    for (let corner = 0; corner < 3; corner++) {
      const which = tile.colors.indexOf(vertex(face * 3 + corner));
      const u = (tile.x + 1.5 + (which === 1 ? span : 0)) / width;
      const v = 1 - (tile.y + 1.5 + (which === 2 ? span : 0)) / height;
      chunk.push(`(${u.toFixed(7)}, ${v.toFixed(7)})`);
    }
    if (chunk.length >= 12288) { chunks.push(chunk.join(', ')); chunk = []; }
  }
  if (chunk.length) chunks.push(chunk.join(', '));
  return { png, uv: chunks.join(', '), hasAlpha };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function pngChunk(type: string, data: Uint8Array) {
  const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(strToU8(type), 4); bytes.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < bytes.length - 4; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}
function encodePng(width: number, height: number, pixels: Uint8Array) {
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header[8] = 8; header[9] = 6;
  const pieces = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', zlibSync(pixels, { level: 6 })), pngChunk('IEND', new Uint8Array())];
  const result = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
  let offset = 0;
  for (const piece of pieces) { result.set(piece, offset); offset += piece.length; }
  return result;
}

function materialBlock(stage: string, name: string) {
  const start = stage.indexOf(`def Material "${name}"`);
  const open = stage.indexOf('{', start);
  if (start < 0 || open < 0) return fail('an exported material is missing.');
  let depth = 1, end = open + 1;
  while (depth && end < stage.length) { if (stage[end] === '{') depth++; else if (stage[end] === '}') depth--; end++; }
  if (depth) return fail('an exported material is incomplete.');
  return stage.slice(start, end);
}

/** Add portable base-color textures to the exported archive. USD faceVarying
 * UVs retain the original indexed positions and normals, avoiding sixfold
 * vertex expansion on dense generated meshes. Each geometry gets one atlas;
 * instances share it, while their material factors remain independent. */
export function bakeVertexColorsIntoUsd(files: Files, colored: Map<number, ColoredGeometry>) {
  if (!colored.size) return;
  let stage = decoder.decode(files['model.usda']);
  const replacements = new Map<string, string>();
  const additions: string[] = [];
  for (const [id, { geometry, materials }] of colored) {
    const path = `geometries/Geometry_${id}.usda`;
    if (!files[path]) fail('an exported geometry is missing.');
    const atlas = makeAtlas(geometry);
    files[`textures/VertexColors_${id}.png`] = atlas.png;
    let mesh = decoder.decode(files[path]);
    // The new material consumes the baked colors; remove the viewport-only
    // primvar so renderers cannot apply the same colors a second time.
    mesh = mesh.replace(/\s*color3f\[\] primvars:displayColor = \[[^\]]*\]\s*\(\s*interpolation = "vertex"\s*\)/, '');
    const marker = 'uniform token subdivisionScheme';
    if (!mesh.includes(marker)) fail('the exported geometry format changed.');
    mesh = mesh.replace(marker, `texCoord2f[] primvars:${UV_NAME} = [${atlas.uv}] (\n\t\t\tinterpolation = "faceVarying"\n\t\t)\n\t\t${marker}`);
    files[path] = strToU8(mesh);
    for (const [materialId, material] of materials) {
      const original = `Material_${materialId}`, name = `${original}_VertexColors_${id}`;
      let block = materialBlock(stage, original).replaceAll(original, name);
      const reader = `VertexColorUV_${id}`, texture = `VertexColorTexture_${id}`;
      const shaderPath = `/Materials/${name}`;
      const diffuse = /color3f inputs:diffuseColor = \([^)]*\)/;
      if (!diffuse.test(block)) fail('the exported material has an unsupported color input.');
      block = block.replace(diffuse, `color3f inputs:diffuseColor.connect = <${shaderPath}/${texture}.outputs:rgb>`);
      if (atlas.hasAlpha && (material.transparent || material.alphaTest > 0)) {
        block = block.replace(/float inputs:opacity = [^\n]+/, `float inputs:opacity.connect = <${shaderPath}/${texture}.outputs:a>${material.alphaTest > 0 ? `\n\t\t\tfloat inputs:opacityThreshold = ${material.alphaTest}` : ''}`);
      }
      const shaders = `\n\t\tdef Shader "${reader}"\n\t\t{\n\t\t\tuniform token info:id = "UsdPrimvarReader_float2"\n\t\t\tstring inputs:varname = "${UV_NAME}"\n\t\t\tfloat2 outputs:result\n\t\t}\n\t\tdef Shader "${texture}"\n\t\t{\n\t\t\tuniform token info:id = "UsdUVTexture"\n\t\t\tasset inputs:file = @textures/VertexColors_${id}.png@\n\t\t\tfloat2 inputs:st.connect = <${shaderPath}/${reader}.outputs:result>\n\t\t\ttoken inputs:sourceColorSpace = "raw"\n\t\t\ttoken inputs:wrapS = "clamp"\n\t\t\ttoken inputs:wrapT = "clamp"\n\t\t\tfloat4 inputs:scale = (${material.color.r}, ${material.color.g}, ${material.color.b}, ${material.opacity})\n\t\t\tfloat3 outputs:rgb\n\t\t\tfloat outputs:a\n\t\t}\n`;
      block = `${block.slice(0, -1)}${shaders}\t}`;
      additions.push(`\n\t${block}\n`);
      replacements.set(`${id}:${materialId}`, name);
    }
  }
  stage = stage.replace(/(prepend references = @\.\/geometries\/Geometry_(\d+)\.usda@<\/Geometry>[\s\S]*?rel material:binding = <\/Materials\/)(Material_(\d+))>/g,
    (match, prefix: string, geometryId: string, _old: string, materialId: string) => {
      const name = replacements.get(`${geometryId}:${materialId}`);
      return name ? `${prefix}${name}>` : match;
    });
  for (const name of replacements.values()) if (!stage.includes(`rel material:binding = </Materials/${name}>`)) fail('a colored mesh material could not be attached.');
  const end = stage.lastIndexOf('}');
  files['model.usda'] = strToU8(`${stage.slice(0, end)}${additions.join('')}${stage.slice(end)}`);
}
