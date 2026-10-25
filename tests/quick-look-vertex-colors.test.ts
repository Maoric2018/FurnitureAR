import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial, Scene, Texture, Uint8BufferAttribute, Uint32BufferAttribute } from 'three';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import { exportQuickLookModel } from '../src/lib/quick-look-model.ts';
import { collectVertexColorGeometry } from '../src/lib/quick-look-vertex-colors.ts';
import { decodePng } from './helpers/png.ts';

function triangle(colors: number[][]) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors.flat(), 3));
  geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  // A nontrivial index order catches an atlas assigned by vertex rather than
  // face-corner order, which silently changes colors on generated meshes.
  geometry.setIndex([0, 2, 1]);
  geometry.computeVertexNormals();
  return geometry;
}

function prim(stage: string, type: string, name: string) {
  const start = stage.indexOf(`def ${type} "${name}"`);
  assert(start >= 0, `Missing ${type} ${name}`);
  const open = stage.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < stage.length; index++) {
    if (stage[index] === '{') depth++;
    if (stage[index] === '}' && --depth === 0) return stage.slice(open + 1, index);
  }
  throw new Error(`Unclosed ${type} ${name}`);
}

function exportedMesh(files: Record<string, Uint8Array>, name: string, sampleCorners?: Set<number>) {
  const stage = new TextDecoder().decode(files['model.usda']);
  const meshStart = stage.indexOf(`def Xform "${name}"`);
  assert(meshStart >= 0, `Missing mesh ${name}`);
  const header = stage.slice(meshStart, stage.indexOf('}', meshStart));
  const geometryPath = header.match(/prepend references = @\.\/([^@]+)@/)?.[1];
  const binding = header.match(/rel material:binding = <([^>]+)>/)?.[1];
  assert(geometryPath && binding, 'The mesh must reference geometry and a material');
  assert(binding.startsWith('/Root/Scenes/Scene/Materials/'));
  const material = prim(stage, 'Material', binding.split('/').at(-1)!);
  const surface = material.match(/outputs:surface.connect = <([^>]+)>/)?.[1];
  assert(surface, 'The bound material must have a surface shader');
  const diffuse = material.match(/inputs:diffuseColor.connect = <([^>]+)>/)?.[1];
  assert(diffuse, 'Vertex colors must drive the surface through a texture, not an unconnected displayColor primvar');
  const texture = prim(material, 'Shader', diffuse.split('/').at(-1)!.split('.')[0]);
  assert.match(texture, /info:id = "UsdUVTexture"/);
  assert.match(texture, /inputs:sourceColorSpace = "raw"/, 'Vertex colors are linear, so the atlas must not be decoded as sRGB');
  const imagePath = texture.match(/asset inputs:file = @([^@]+)@/)?.[1];
  assert(imagePath && files[imagePath], 'The connected vertex-color image must be embedded');
  assert.match(material, /inputs:varname = "vertexColorUV"/);
  const geometry = new TextDecoder().decode(files[geometryPath]);
  const uvAttribute = geometry.match(/(?:texCoord2f|float2)\[\] primvars:vertexColorUV = \[([^\]]+)\]\s*\(\s*interpolation = "faceVarying"/);
  assert(uvAttribute, 'The atlas needs a UV coordinate for each indexed face corner');
  const uvs: number[][] = [];
  let uvCount = 0;
  for (const match of uvAttribute[1].matchAll(/\(([^,]+),\s*([^)]+)\)/g)) {
    if (!sampleCorners || sampleCorners.has(uvCount)) uvs.push([Number(match[1]), Number(match[2])]);
    uvCount++;
  }
  return { binding, material, texture, imagePath, uvs, uvCount, image: decodePng(files[imagePath]) };
}

function sample(image: ReturnType<typeof decodePng>, uv: number[]) {
  return image.pixel(Math.min(image.width - 1, Math.floor(uv[0] * image.width)), Math.min(image.height - 1, Math.floor((1 - uv[1]) * image.height))).map(channel => channel / 255);
}

function sampleBilinear(image: ReturnType<typeof decodePng>, uv: number[]) {
  const x = uv[0] * image.width - .5, y = (1 - uv[1]) * image.height - .5;
  const left = Math.floor(x), top = Math.floor(y), u = x - left, v = y - top;
  const pixel = (dx: number, dy: number) => image.pixel(Math.max(0, Math.min(image.width - 1, left + dx)), Math.max(0, Math.min(image.height - 1, top + dy)));
  const [a, b, c, d] = [pixel(0, 0), pixel(1, 0), pixel(0, 1), pixel(1, 1)];
  return a.map((_, channel) => ((a[channel] * (1 - u) + b[channel] * u) * (1 - v) + (c[channel] * (1 - u) + d[channel] * u) * v) / 255);
}

function close(actual: number[], expected: number[], tolerance: number, label: string) {
  assert(actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance), `${label}: ${actual} != ${expected}`);
}

test('Quick Look bakes indexed vertex colors into connected atlas pixels with preserved corner colors and interpolation', async () => {
  const colors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const geometry = triangle(colors);
  const material = new MeshStandardMaterial({ vertexColors: true });
  const mesh = new Mesh(geometry, material); mesh.name = 'VertexTriangle';
  const scene = new Scene(); scene.add(mesh); scene.updateMatrixWorld(true);
  const result = exportedMesh(unzipSync(await exportQuickLookModel(scene)), mesh.name);
  assert.equal(result.uvs.length, 3);
  for (let corner = 0; corner < 3; corner++) {
    close(sample(result.image, result.uvs[corner]), colors[geometry.index!.getX(corner)], .005, `Face corner ${corner}`);
  }
  const center = [0, 1].map(axis => result.uvs.reduce((sum, uv) => sum + uv[axis], 0) / 3);
  close(sample(result.image, center), [1 / 3, 1 / 3, 1 / 3], .04, 'Interpolated triangle center');
});

test('Compact affine tiles preserve bilinear colors beside larger high-contrast tiles', async () => {
  const colors = [[.15, .2, .25], [.45, .3, .4], [.25, .6, .55]];
  const affine = new Mesh(triangle(colors), new MeshStandardMaterial({ vertexColors: true })); affine.name = 'Affine';
  const complex = new Mesh(triangle([[1, 0, 0], [0, 1, 0], [0, 0, 1]]), affine.material); complex.name = 'Complex';
  // One geometry containing both tile sizes exercises mixed atlas packing.
  const geometry = new BufferGeometry();
  for (const attribute of ['position', 'color', 'normal']) {
    geometry.setAttribute(attribute, new Float32BufferAttribute([
      ...affine.geometry.getAttribute(attribute).array, ...complex.geometry.getAttribute(attribute).array,
    ], 3));
  }
  geometry.setIndex([0, 2, 1, 3, 5, 4]);
  const mesh = new Mesh(geometry, affine.material); mesh.name = 'MixedTiles';
  const scene = new Scene(); scene.add(mesh); scene.updateMatrixWorld(true);
  const result = exportedMesh(unzipSync(await exportQuickLookModel(scene)), mesh.name);
  for (let face = 0; face < 2; face++) {
    const uvs = result.uvs.slice(face * 3, face * 3 + 3);
    const span = Math.max(...uvs.map(uv => uv[0])) - Math.min(...uvs.map(uv => uv[0]));
    assert(Math.abs(span * result.image.width - (face ? 9 : 1)) < .0001, 'Affine patches need one texel span; complex patches retain nine');
    const source = [0, 1, 2].map(corner => {
      const index = geometry.index!.getX(face * 3 + corner), colors = geometry.getAttribute('color');
      return [colors.getX(index), colors.getY(index), colors.getZ(index)];
    });
    for (const weights of [[.2, .3, .5], [1 / 3, 1 / 3, 1 / 3], [.01, .49, .5], [0, .5, .5]]) {
      const uv = [0, 1].map(axis => uvs.reduce((sum, point, index) => sum + point[axis] * weights[index], 0));
      const expected = [0, 1, 2].map(channel => source.reduce((sum, color, index) => sum + color[channel] * weights[index], 0));
      close(sampleBilinear(result.image, uv), expected, face ? .04 : .005, `Mixed face ${face}, weights ${weights}`);
    }
  }
});

test('Dense affine vertex colors fit a 4096 atlas beyond the previous six-pixel tile limit', async () => {
  const faces = 470_000;
  assert(faces * 6 ** 2 > 4092 ** 2, 'This fixture must exceed the previous tile budget');
  // Indexed fan triangles share two black vertices. Every third vertex has a
  // unique byte color, giving 470,000 distinct affine gradients without an
  // unnecessarily expanded source mesh or a large checked-in binary fixture.
  const positions = new Float32Array((faces + 2) * 3), normals = new Float32Array(positions.length);
  const colors = new Uint8Array(positions.length), indices = new Uint32Array(faces * 3);
  positions[3] = 1; normals[2] = normals[5] = 1;
  for (let face = 0; face < faces; face++) {
    const vertex = face + 2;
    positions[vertex * 3 + 1] = 1; normals[vertex * 3 + 2] = 1;
    colors.set([16 + face % 224, 16 + Math.floor(face / 224) % 224, 16 + Math.floor(face / (224 * 224))], vertex * 3);
    indices.set([0, 1, vertex], face * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Uint8BufferAttribute(colors, 3, true));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true })); mesh.name = 'DenseAffine';
  const scene = new Scene(); scene.add(mesh); scene.updateMatrixWorld(true);
  const sampledFaces = [0, 1, 223, 224, Math.floor(faces / 2), faces - 1];
  const corners = new Set(sampledFaces.flatMap(face => [face * 3, face * 3 + 1, face * 3 + 2]));
  const result = exportedMesh(unzipSync(await exportQuickLookModel(scene)), mesh.name, corners);
  assert(result.image.width <= 4096 && result.image.height <= 4096, 'Dense colors must keep the existing mobile texture limit');
  assert.equal(result.uvCount, faces * 3, 'Every face corner must retain a texture coordinate');
  assert.equal(result.uvs.length, sampledFaces.length * 3);
  for (const [sampleIndex, face] of sampledFaces.entries()) {
    const uvs = result.uvs.slice(sampleIndex * 3, sampleIndex * 3 + 3);
    const rgb = [...colors.subarray((face + 2) * 3, (face + 3) * 3)].map(channel => channel / 255);
    close(sampleBilinear(result.image, uvs[2]), rgb, .001, `Dense face ${face} corner`);
    for (const weights of [[.2, .3, .5], [1 / 3, 1 / 3, 1 / 3], [0, .1, .9]]) {
      const uv = [0, 1].map(axis => uvs.reduce((sum, point, index) => sum + point[axis] * weights[index], 0));
      close(sampleBilinear(result.image, uv), rgb.map(channel => channel * weights[2]), .001, `Dense face ${face} interpolated color`);
    }
  }
});

test('Quick Look keeps each geometry’s vertex color when meshes share a material and leaves the source scene unchanged', async () => {
  const red = triangle([[.8, .1, .05], [.8, .1, .05], [.8, .1, .05]]);
  const blue = triangle([[.05, .2, .9], [.05, .2, .9], [.05, .2, .9]]);
  const material = new MeshStandardMaterial({ vertexColors: true });
  material.color.setRGB(.5, .75, 1);
  const meshes = [new Mesh(red, material), new Mesh(red, material), new Mesh(blue, material)];
  meshes.forEach((mesh, index) => { mesh.name = `Shared_${index}`; mesh.position.x = index * 2; });
  const scene = new Scene(); scene.add(...meshes); scene.updateMatrixWorld(true);
  const before = [red, blue].map(geometry => JSON.stringify(geometry.toJSON()));
  const materialBefore = JSON.stringify(material.toJSON());
  const files = unzipSync(await exportQuickLookModel(scene));
  const results = meshes.map(mesh => exportedMesh(files, mesh.name));
  assert.equal(results[0].imagePath, results[1].imagePath, 'Shared geometry should reuse its atlas');
  assert.notEqual(results[0].binding, results[2].binding, 'Different geometry colors need separate texture bindings even when the original material is shared');
  for (const [index, result] of results.entries()) {
    for (const uv of result.uvs) close(sample(result.image, uv), index < 2 ? [.8, .1, .05] : [.05, .2, .9], .005, `Mesh ${index}`);
    assert.match(result.texture, /inputs:scale = \(0\.5, 0\.75, 1(?:\.0)?, 1(?:\.0)?\)/, 'Material tint must still multiply the baked vertex color');
  }
  for (const [index, geometry] of [red, blue].entries()) assert.equal(JSON.stringify(geometry.toJSON()), before[index], 'AR export must not rewrite the browser preview geometry');
  assert.equal(JSON.stringify(material.toJSON()), materialBefore, 'AR export must not replace the browser preview material');
  assert(meshes.every(mesh => mesh.material === material), 'Original shared material references must be retained');
  assert.equal(meshes[0].geometry, meshes[1].geometry, 'Original shared geometry references must be retained');
});

test('Quick Look respects normalized integer vertex colors instead of treating their bytes as linear floats', async () => {
  const geometry = triangle([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  geometry.setAttribute('color', new Uint8BufferAttribute([255, 128, 0, 255, 128, 0, 255, 128, 0], 3, true));
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true })); mesh.name = 'NormalizedColors';
  const scene = new Scene(); scene.add(mesh); scene.updateMatrixWorld(true);
  const result = exportedMesh(unzipSync(await exportQuickLookModel(scene)), mesh.name);
  for (const uv of result.uvs) close(sample(result.image, uv), [1, 128 / 255, 0], .005, 'Normalized COLOR_0');
});

test('Instances sharing colored geometry reuse its atlas while retaining their independent material tints', async () => {
  const geometry = triangle([[.2, .8, .1], [.2, .8, .1], [.2, .8, .1]]);
  const first = new MeshStandardMaterial({ vertexColors: true }); first.color.setRGB(.25, .5, .75);
  const second = new MeshStandardMaterial({ vertexColors: true }); second.color.setRGB(.8, .6, .4);
  const meshes = [new Mesh(geometry, first), new Mesh(geometry, second)];
  meshes.forEach((mesh, index) => { mesh.name = `Tint_${index}`; });
  const scene = new Scene(); scene.add(...meshes); scene.updateMatrixWorld(true);
  const files = unzipSync(await exportQuickLookModel(scene));
  const [a, b] = meshes.map(mesh => exportedMesh(files, mesh.name));
  assert.equal(a.imagePath, b.imagePath);
  assert.notEqual(a.binding, b.binding);
  assert.match(a.texture, /inputs:scale = \(0\.25, 0\.5, 0\.75, 1(?:\.0)?\)/);
  assert.match(b.texture, /inputs:scale = \(0\.8, 0\.6, 0\.4, 1(?:\.0)?\)/);
  for (const result of [a, b]) close(sample(result.image, result.uvs[0]), [.2, .8, .1], .005, 'Shared untinted atlas');
});

test('Unsupported combined vertex colors and image textures fail clearly instead of exporting a misleading color', async () => {
  const geometry = triangle([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  const material = new MeshStandardMaterial({ vertexColors: true, map: new Texture() });
  const scene = new Scene(); scene.add(new Mesh(geometry, material));
  await assert.rejects(exportQuickLookModel(scene), /combined image textures and vertex colors need a texture bake/);
  assert.equal(material.vertexColors, true);
  assert(material.map, 'A failed export must preserve the original textured preview');
});

test('Existing textures bypass the vertex bake only when every RGB and alpha multiplier is one', () => {
  const geometry = triangle([[1, 1, 1], [1, 1, 1], [1, 1, 1]]);
  const material = new MeshStandardMaterial({ vertexColors: true, map: new Texture() });
  const scene = new Scene(); scene.add(new Mesh(geometry, material));
  assert.equal(collectVertexColorGeometry(scene).size, 0, 'White RGB must preserve the existing textured export');
  const rgba = new Uint8BufferAttribute(new Uint8Array(12).fill(255), 4, true);
  geometry.setAttribute('color', rgba);
  assert.equal(collectVertexColorGeometry(scene).size, 0, 'Normalized unit RGBA must preserve the texture too');
  for (const channel of [0, 1, 2, 3]) {
    rgba.array[8 + channel] = 254;
    assert.throws(() => collectVertexColorGeometry(scene), /combined image textures and vertex colors need a texture bake/, `Non-unit channel ${channel} must not be silently ignored`);
    rgba.array[8 + channel] = 255;
  }
  material.map = null; material.alphaMap = new Texture();
  assert.equal(collectVertexColorGeometry(scene).size, 0, 'Unit vertex colors must also preserve an existing opacity texture');
  rgba.array[11] = 128;
  assert.throws(() => collectVertexColorGeometry(scene), /combined opacity textures and vertex colors need a texture bake/);
});

test('RGBA vertex colors preserve alpha pixels and opacity scale, with alphaTest authored on PreviewSurface', async () => {
  const geometry = triangle([[.2, .8, .1], [.2, .8, .1], [.2, .8, .1]]);
  geometry.setAttribute('color', new Float32BufferAttribute([.2, .8, .1, .25, .2, .8, .1, .25, .2, .8, .1, .25], 4));
  const material = new MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: .6, alphaTest: .4 });
  const mesh = new Mesh(geometry, material); mesh.name = 'VertexAlpha';
  const scene = new Scene(); scene.add(mesh); scene.updateMatrixWorld(true);
  const result = exportedMesh(unzipSync(await exportQuickLookModel(scene)), mesh.name);
  assert.equal(result.image.channels, 4);
  for (const uv of result.uvs) {
    const x = Math.floor(uv[0] * result.image.width), y = Math.floor((1 - uv[1]) * result.image.height);
    assert(Math.abs(result.image.pixels[(y * result.image.width + x) * 4 + 3] / 255 - .25) < .005, 'Atlas alpha must retain the authored vertex opacity');
  }
  assert.match(result.texture, /inputs:scale = \(1(?:\.0)?, 1(?:\.0)?, 1(?:\.0)?, 0\.6\)/);
  const preview = prim(result.material, 'Shader', 'PreviewSurface');
  assert.match(preview, /inputs:opacity.connect = <[^>]+\/VertexColorTexture_\d+\.outputs:a>/);
  assert.match(preview, /float inputs:opacityThreshold = 0\.4/, 'Alpha cutoff belongs to the surface shader, not its Material container');
  assert.equal([...result.material.matchAll(/inputs:opacityThreshold/g)].length, 1, 'Only the surface shader should define the cutoff');
});

const nativeUsdAvailable = !spawnSync('usdcat', ['--help'], { encoding: 'utf8' }).error
  && !spawnSync('usdchecker', ['--help'], { encoding: 'utf8' }).error;

test('The baked vertex-color shader and UV binding survive native active-scene import', {
  skip: nativeUsdAvailable ? false : 'Native usdcat/usdchecker tools are not installed',
}, async () => {
  const scene = new Scene();
  scene.add(new Mesh(triangle([[1, 0, 0], [0, 1, 0], [0, 0, 1]]), new MeshStandardMaterial({ vertexColors: true })));
  scene.updateMatrixWorld(true);
  const directory = await mkdtemp(join(tmpdir(), 'furniturear-vertex-atlas-'));
  try {
    const asset = join(directory, 'vertex.usdz');
    await writeFile(asset, await exportQuickLookModel(scene));
    execFileSync('usdchecker', ['--arkit', asset], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const reference = join(directory, 'scene.usda');
    await writeFile(reference, '#usda 1.0\ndef Xform "Placed" (prepend references = @vertex.usdz@</Root/Scenes/Scene>) {}\n');
    const result = spawnSync('usdcat', ['--flatten', reference], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert(!result.stderr.includes('outside the scope of the reference'), result.stderr);
    assert.match(result.stdout, /inputs:diffuseColor.connect = <\/Placed\/Materials\/[^>]+\/VertexColorTexture_\d+\.outputs:rgb>/);
    assert.match(result.stdout, /inputs:varname = "vertexColorUV"/);
    assert.match(result.stdout, /primvars:vertexColorUV/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
