import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoxGeometry, Mesh, MeshStandardMaterial, Scene } from 'three';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { exportQuickLookModel } from '../src/lib/quick-look-model.ts';
import { arrangeModels } from '../src/lib/layout-model.ts';
import { catalog } from '../src/lib/products.ts';
import { createProductItem } from '../src/lib/workspace.ts';

const materialScope = '/Root/Scenes/Scene/Materials/';
const moss = [0.20507873637973145, 0.24620132669705552, 0.1499597898006365];
const wood = [0.1912016827303171, 0.09084171117479915, 0.04231141061442144];

async function sundaySofaLayout() {
  const product = catalog.find(product => product.id === 'sunday-sofa')!;
  const variant = product.variants.find(variant => variant.id === 'moss')!;
  const bytes = await readFile(new URL(`../public${variant.modelSrc}`, import.meta.url));
  const model = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const item = { ...createProductItem('https://example.com/sunday-sofa', product), variantId: variant.id, x: 0, z: 0, rotation: 0 };
  const scene = arrangeModels([item], new Map([[variant.modelSrc, model.scene]]));
  scene.updateMatrixWorld(true);
  return scene;
}

function stageFromArchive(bytes: Uint8Array) {
  return new TextDecoder().decode(unzipSync(bytes)['model.usda']);
}

function boundColors(stage: string) {
  const colors = new Map([...stage.matchAll(/def Material "([^"]+)"[\s\S]*?color3f inputs:diffuseColor = \(([^)]+)\)/g)]
    .map(match => [match[1], match[2].split(',').map(Number)]));
  return [...stage.matchAll(/rel material:binding = <([^>]+)>/g)].map(match => {
    const color = colors.get(match[1].split('/').at(-1)!);
    assert(color, `Bound material ${match[1]} must have a diffuse color`);
    return color;
  });
}

function assertSofaColors(stage: string) {
  const colors = boundColors(stage);
  const count = (expected: number[]) => colors.filter(color => color.every((channel, index) => Math.abs(channel - expected[index]) < 1e-6)).length;
  assert.equal(colors.length, 11, 'Every sofa mesh must retain its material binding');
  assert.equal(count(moss), 7, 'All seven upholstery meshes must remain Moss green');
  assert.equal(count(wood), 4, 'All four sofa feet must retain their wood color');
}

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

test('Quick Look packages keep material/shader targets within the active scene and retain USDZ alignment', async () => {
  const bytes = await exportQuickLookModel(coloredScene());
  const entries = archiveEntries(bytes);
  assert.equal(entries[0]?.name, 'model.usda', 'The USD stage must be the first archive entry');
  for (const entry of entries) {
    assert.equal(entry.compression, 0, `${entry.name} must be stored uncompressed`);
    assert.equal(entry.dataOffset % 64, 0, `${entry.name} must start on a 64-byte boundary`);
  }
  const stage = stageFromArchive(bytes);
  assert.match(stage, /defaultPrim = "Root"/);
  const materialBindings = [...stage.matchAll(/rel material:binding = <([^>]+)>/g)].map(match => match[1]);
  assert.equal(materialBindings.length, 2);
  assert(materialBindings.every(path => path.startsWith(materialScope)));
  assert(!stage.includes('</Materials/') && !stage.includes('</Root/Materials/'), 'No material or shader relationship may leave the active scene');
  assert.match(stage, /color3f inputs:diffuseColor = \(1, 0, 0\)/);
  assert.match(stage, /color3f inputs:diffuseColor = \(0, 0, 1\)/);
});

test('The Sunday Sofa in a Moss saved layout retains all eleven colored pieces in Quick Look', async () => {
  const stage = stageFromArchive(await exportQuickLookModel(await sundaySofaLayout()));
  assertSofaColors(stage);
  assert([...stage.matchAll(/rel material:binding = <([^>]+)>/g)].every(match => match[1].startsWith(materialScope)));
});

const nativeUsdAvailable = !spawnSync('usdcat', ['--help'], { encoding: 'utf8' }).error
  && !spawnSync('usdchecker', ['--help'], { encoding: 'utf8' }).error;

test('Root and active-scene references retain resolved materials and surface shaders in native USD composition', {
  skip: nativeUsdAvailable ? false : 'Native usdcat/usdchecker tools are not installed',
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'furniturear-quick-look-'));
  try {
    const asset = join(directory, 'furniture.usdz');
    await writeFile(asset, await exportQuickLookModel(coloredScene()));
    execFileSync('usdchecker', ['--arkit', asset], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    for (const [name, sourcePrim, targetScope] of [
      ['root', '/Root', '/PlacedFurniture/Scenes/Scene/Materials/'],
      ['scene', '/Root/Scenes/Scene', '/PlacedFurniture/Materials/'],
    ]) {
      const stage = await referencedStage(directory, 'furniture.usdz', name, sourcePrim);
      const bindings = [...stage.matchAll(/rel material:binding = <([^>]+)>/g)].map(match => match[1]);
      assert.equal(bindings.length, 2, 'Both placed meshes must still have material bindings after import');
      assert(bindings.every(path => path.startsWith(targetScope)));
      const surfaces = [...stage.matchAll(/token outputs:surface.connect = <([^>]+)>/g)].map(match => match[1]);
      assert.equal(surfaces.length, 2, 'Both bound materials must still have surface shader connections');
      for (const binding of bindings) {
        assert(surfaces.includes(`${binding}/PreviewSurface.outputs:surface`));
        assert(stage.includes(`def Material "${binding.split('/').at(-1)}"`), 'The bound material must exist in the imported subtree');
      }
      assert.match(stage, /color3f inputs:diffuseColor = \(1, 0, 0\)/);
      assert.match(stage, /color3f inputs:diffuseColor = \(0, 0, 1\)/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function referencedStage(directory: string, asset: string, name: string, sourcePrim: string) {
  const reference = join(directory, `${name}.usda`);
  await writeFile(reference, `#usda 1.0\n(\n defaultPrim = "PlacedFurniture"\n metersPerUnit = 1\n upAxis = "Y"\n)\ndef Xform "PlacedFurniture" (\n prepend references = @${asset}@<${sourcePrim}>\n) {}\n`);
  const flattened = spawnSync('usdcat', ['--flatten', reference], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert.equal(flattened.status, 0, flattened.stderr);
  assert(!flattened.stderr.includes('outside the scope of the reference'), flattened.stderr);
  return flattened.stdout;
}

test('Native USD keeps the saved-layout Sunday Sofa green when importing either Root or its active Scene', {
  skip: nativeUsdAvailable ? false : 'Native usdcat/usdchecker tools are not installed',
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'furniturear-moss-sofa-'));
  try {
    const asset = join(directory, 'sofa.usdz');
    await writeFile(asset, await exportQuickLookModel(await sundaySofaLayout()));
    execFileSync('usdchecker', ['--arkit', asset], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    for (const [name, sourcePrim] of [['root', '/Root'], ['scene', '/Root/Scenes/Scene']]) {
      assertSofaColors(await referencedStage(directory, 'sofa.usdz', name, sourcePrim));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
