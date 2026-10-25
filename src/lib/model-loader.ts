import { LoadingManager, TextureLoader } from 'three';
import type { Mesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';

const textureError = () => new Error('This model’s textures couldn’t load. Please try again.');

function textureReferences(value: unknown, indices: Set<number>) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'extras') continue;
    if (key.endsWith('Texture') && child && typeof child === 'object' && 'index' in child && Number.isInteger(child.index)) {
      indices.add(child.index as number);
    } else {
      textureReferences(child, indices);
    }
  }
}

async function checkMaterialTextures(model: GLTF) {
  const indices = new Set<number>();
  model.scene.traverse(object => {
    const material = (object as Mesh).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) {
      const index = model.parser.associations.get(entry)?.materials;
      if (index !== undefined) textureReferences(model.parser.json.materials[index], indices);
    }
  });
  // GLTFLoader deliberately resolves failed image/decoder loads to null. Check
  // actual material references so a partial, white model is never re-exported.
  // Materials using only solid or vertex colors need no texture at all.
  const textures = await Promise.all([...indices].map(index => model.parser.getDependency('texture', index)));
  if (textures.some(texture => !texture)) throw textureError();
}

/** Parse models for re-export without depending on ImageBitmap decoding in WebKit. */
export async function parseModelWithTextures(buffer: ArrayBuffer, resourcePath = '', signal?: AbortSignal): Promise<GLTF> {
  signal?.throwIfAborted();
  const manager = new LoadingManager();
  let resourceFailed = false;
  manager.onError = () => { resourceFailed = true; };
  const loader = new GLTFLoader(manager);
  loader.register(parser => {
    // A manager URL handler alone misses images embedded in GLB bufferViews.
    // Replacing the parser's loader also covers the built-in WebP/AVIF plugins;
    // GLTFLoader still applies samplers, UV transforms, flipY and color spaces.
    parser.textureLoader = new TextureLoader(manager)
      .setCrossOrigin(parser.options.crossOrigin)
      .setRequestHeader(parser.options.requestHeader);
    return { name: 'FURNITURE_preserve_textures' };
  });
  const model = await loader.parseAsync(buffer, resourcePath);
  signal?.throwIfAborted();
  if (resourceFailed) throw textureError();
  await checkMaterialTextures(model);
  signal?.throwIfAborted();
  return model;
}

/** Embedded, uploaded models have opaque blob/data URLs with no relative directory. */
export function modelResourcePath(src: string, base: string): string {
  const url = new URL(src, base);
  return url.protocol === 'blob:' || url.protocol === 'data:' ? '' : new URL('.', url).href;
}
