import test from 'node:test';
import assert from 'node:assert/strict';
import { ClampToEdgeWrapping, Mesh, MeshStandardMaterial, NearestFilter, SRGBColorSpace, Texture, TextureLoader } from 'three';
import { modelResourcePath, parseModelWithTextures } from '../src/lib/model-loader.ts';

function fixture(options: { texture?: 'embedded' | 'uri' | 'webp'; brokenBuffer?: boolean; vertexColors?: boolean; unusedTexture?: boolean } = {}) {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1]);
  const uv = new Float32Array([0, 0, 1, 0, 0, 1]);
  const colors = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const binary = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(uv.buffer), Buffer.from(colors.buffer), Buffer.alloc(4)]);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }, { buffer: 0, byteOffset: 60, byteLength: 36 }, { buffer: options.brokenBuffer ? 1 : 0, byteOffset: 96, byteLength: 4 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1, ...(options.vertexColors ? { COLOR_0: 2 } : {}) }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { ...(options.texture ? { baseColorTexture: { index: 0 } } : { baseColorFactor: [.2, .4, .6, 1] }) } }],
    ...((options.texture || options.unusedTexture) ? {
      images: [options.texture === 'uri' ? { uri: 'fabric.png' } : { bufferView: 3, mimeType: options.texture === 'webp' ? 'image/webp' : 'image/png' }],
      samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
      textures: [{ sampler: 0, ...(options.texture === 'webp' ? { extensions: { EXT_texture_webp: { source: 0 } } } : { source: 0 }) }],
    } : {}),
    ...(options.texture === 'webp' ? { extensionsUsed: ['EXT_texture_webp'] } : {}),
  };
  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20); encoded.copy(padded);
  const result = Buffer.alloc(12 + 8 + padded.length + 8 + binary.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded.length, 12); result.writeUInt32LE(0x4e4f534a, 16); padded.copy(result, 20);
  result.writeUInt32LE(binary.length, 20 + padded.length); result.writeUInt32LE(0x004e4942, 24 + padded.length); binary.copy(result, 28 + padded.length);
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
}

// Exercise Three's real GLTFLoader and ImageLoader. These image events simulate
// browser decode success/failure; the browser regression also verifies pixels.
async function withImageDecoder(fails: boolean, run: (images: string[], bitmapCalls: () => number) => Promise<void>) {
  const keys = ['document', 'self', 'createImageBitmap'] as const;
  const descriptors = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const images: string[] = [];
  let calls = 0;
  class DecodedImage extends EventTarget {
    width = 2; height = 2; naturalWidth = 2; naturalHeight = 2; complete = true;
    set src(url: string) {
      images.push(url);
      queueMicrotask(() => this.dispatchEvent(new Event(fails ? 'error' : 'load')));
    }
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElementNS: (_namespace: string, tag: string) => { assert.equal(tag, 'img'); return new DecodedImage(); } } });
  Object.defineProperty(globalThis, 'self', { configurable: true, value: globalThis });
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async () => { calls++; throw new Error('WebKit bitmap decoding unavailable'); } });
  try { await run(images, () => calls); }
  finally { keys.forEach((key, index) => { const previous = descriptors[index]; if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); }); }
}

test('Embedded and external textures retain glTF sampling and color space when ImageBitmap decoding is unavailable', async () => {
  await withImageDecoder(false, async (images, bitmapCalls) => {
    for (const texture of ['embedded', 'uri', 'webp'] as const) {
      const model = await parseModelWithTextures(fixture({ texture }), 'https://models.example/assets/');
      const material = (model.scene.children[0] as Mesh).material as MeshStandardMaterial;
      assert.ok(material.map?.image);
      assert.equal(material.map.flipY, false);
      assert.equal(material.map.colorSpace, SRGBColorSpace);
      assert.equal(material.map.magFilter, NearestFilter);
      assert.equal(material.map.wrapS, ClampToEdgeWrapping);
    }
    assert.equal(images.length, 3);
    assert.equal(images[1], 'https://models.example/assets/fabric.png');
    assert.equal(bitmapCalls(), 0);
  });
});

test('Failed image decodes reject instead of returning a white, textureless model', async context => {
  context.mock.method(console, 'error', () => {});
  await withImageDecoder(true, async () => {
    for (const texture of ['embedded', 'uri', 'webp'] as const) {
      await assert.rejects(parseModelWithTextures(fixture({ texture }), 'https://models.example/'), /textures couldn’t load/);
    }
  });
});

test('A referenced texture whose buffer fails before image decoding cannot silently disappear', async context => {
  context.mock.method(console, 'error', () => {});
  await withImageDecoder(false, async images => {
    await assert.rejects(parseModelWithTextures(fixture({ texture: 'embedded', brokenBuffer: true })));
    assert.equal(images.length, 0);
  });
});

test('Decoder rejections are detected even when LoadingManager receives no error notification', async context => {
  context.mock.method(console, 'error', () => {});
  context.mock.method(TextureLoader.prototype, 'load', (_url: string, _onLoad: unknown, _onProgress: unknown, onError: (error: Error) => void) => {
    queueMicrotask(() => onError(new Error('Decoder rejected the image')));
    return new Texture();
  });
  await withImageDecoder(false, async () => {
    await assert.rejects(parseModelWithTextures(fixture({ texture: 'embedded' })), /textures couldn’t load/);
    await assert.rejects(parseModelWithTextures(fixture({ texture: 'webp' })), /textures couldn’t load/);
  });
});

test('Solid and vertex colors remain valid without textures, including unused broken texture definitions', async () => {
  await withImageDecoder(true, async images => {
    for (const vertexColors of [false, true]) {
      const model = await parseModelWithTextures(fixture({ vertexColors, unusedTexture: true, brokenBuffer: true }));
      const material = (model.scene.children[0] as Mesh).material as MeshStandardMaterial;
      assert.equal(material.vertexColors, vertexColors);
      assert.deepEqual(material.color.toArray(), [.2, .4, .6]);
      assert.equal(material.map, null);
    }
    assert.equal(images.length, 0);
  });
});

test('Uploaded blob/data models and relative hosted models resolve their texture directory safely', () => {
  const base = 'https://furniture.example/layout';
  assert.equal(modelResourcePath('blob:https://furniture.example/123', base), '');
  assert.equal(modelResourcePath('data:model/gltf-binary;base64,AAAA', base), '');
  assert.equal(modelResourcePath('/models/table.glb?version=2', base), 'https://furniture.example/models/');
});
