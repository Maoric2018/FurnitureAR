import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoxGeometry, Mesh, MeshStandardMaterial, Scene } from 'three';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import { exportQuickLookModel } from '../src/lib/quick-look-model.ts';

function coloredScene() {
  const scene = new Scene();
  for (const [index, color] of [0xff0000, 0x0000ff].entries()) {
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color }));
    mesh.name = `Colored_piece_${index}`;
    mesh.position.x = index * 2;
    scene.add(mesh);
  }
  scene.updateMatrixWorld(true);
  return scene;
}

function archiveEntries(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: { name: string; dataOffset: number; compression: number }[] = [];
  let offset = 0;
  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const compression = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const dataOffset = offset + 30 + nameLength + extraLength;
    entries.push({ name, dataOffset, compression });
    offset = dataOffset + size;
  }
  return entries;
}

test('Quick Look packages keep material/shader targets within the default prim and retain USDZ alignment', async () => {
  const bytes = await exportQuickLookModel(coloredScene());
  const entries = archiveEntries(bytes);
  assert.equal(entries[0]?.name, 'model.usda', 'The USD stage must be the first archive entry');
  for (const entry of entries) {
    assert.equal(entry.compression, 0, `${entry.name} must be stored uncompressed`);
    assert.equal(entry.dataOffset % 64, 0, `${entry.name} must start on a 64-byte boundary`);
  }
  const files = unzipSync(bytes);
  const stage = new TextDecoder().decode(files['model.usda']);
  assert.match(stage, /defaultPrim = "Root"/);
  const materialBindings = [...stage.matchAll(/rel material:binding = <([^>]+)>/g)].map(match => match[1]);
  assert.equal(materialBindings.length, 2);
  assert(materialBindings.every(path => path.startsWith('/Root/Materials/')));
  assert(!stage.includes('</Materials/'), 'No material or shader relationship may leave the default prim');
  assert.match(stage, /color3f inputs:diffuseColor = \(1, 0, 0\)/);
  assert.match(stage, /color3f inputs:diffuseColor = \(0, 0, 1\)/);
});

const nativeUsdAvailable = !spawnSync('usdcat', ['--help'], { encoding: 'utf8' }).error
  && !spawnSync('usdchecker', ['--help'], { encoding: 'utf8' }).error;

test('A referenced Quick Look asset retains resolved materials and surface shaders in native USD composition', {
  skip: nativeUsdAvailable ? false : 'Native usdcat/usdchecker tools are not installed',
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'furniturear-quick-look-'));
  try {
    const asset = join(directory, 'furniture.usdz');
    const reference = join(directory, 'reference.usda');
    await writeFile(asset, await exportQuickLookModel(coloredScene()));
    await writeFile(reference, '#usda 1.0\n(\n defaultPrim = "PlacedFurniture"\n metersPerUnit = 1\n upAxis = "Y"\n)\ndef Xform "PlacedFurniture" (\n prepend references = @furniture.usdz@\n) {}\n');
    execFileSync('usdchecker', ['--arkit', asset], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const flattened = spawnSync('usdcat', ['--flatten', reference], { encoding: 'utf8' });
    assert.equal(flattened.status, 0, flattened.stderr);
    assert(!flattened.stderr.includes('outside the scope of the reference'), flattened.stderr);
    const stage = flattened.stdout;
    const bindings = [...stage.matchAll(/rel material:binding = <([^>]+)>/g)].map(match => match[1]);
    assert.equal(bindings.length, 2, 'Both placed meshes must still have material bindings after import');
    assert(bindings.every(path => path.startsWith('/PlacedFurniture/Materials/')));
    const surfaces = [...stage.matchAll(/token outputs:surface.connect = <([^>]+)>/g)].map(match => match[1]);
    assert.equal(surfaces.length, 2, 'Both bound materials must still have surface shader connections');
    for (const binding of bindings) {
      assert(surfaces.includes(`${binding}/PreviewSurface.outputs:surface`));
      assert(stage.includes(`def Material "${binding.split('/').at(-1)}"`), 'The bound material must exist in the imported subtree');
    }
    assert.match(stage, /color3f inputs:diffuseColor = \(1, 0, 0\)/);
    assert.match(stage, /color3f inputs:diffuseColor = \(0, 0, 1\)/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
