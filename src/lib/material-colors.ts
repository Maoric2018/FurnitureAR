import type { Model, RGBA } from '@google/model-viewer/lib/features/scene-graph/api.js';
import type { Color, Material, Mesh, Object3D, Texture } from 'three';
import type { MaterialColorOverride } from './products';

type ColorMaterial = Material & { color: Color; map: Texture | null };

/** A finish targets explicit glTF material names, never a mesh index or every surface. */
function resolveOverrides<T extends { name: string }>(materials: T[], overrides: MaterialColorOverride[]) {
  const seen = new Set<string>();
  return overrides.flatMap(override => {
    if (!override.materialName || !/^#[0-9a-f]{6}$/i.test(override.color) || seen.has(override.materialName)) {
      throw new Error('This finish has invalid material colors. Choose another finish.');
    }
    seen.add(override.materialName);
    const targets = materials.filter(material => material.name === override.materialName);
    if (!targets.length) throw new Error(`This finish couldn’t find the “${override.materialName}” material. Choose another finish before opening AR.`);
    return targets.map(material => ({ material, color: override.color }));
  });
}

/** Uses only model-viewer's public scenegraph API. Keep this controller per loaded model. */
export function createViewerColorController(model: Model) {
  const originals = model.materials.filter(material => material.isLoaded && material.isActive).map(material => ({
    material,
    factor: [...material.pbrMetallicRoughness.baseColorFactor] as RGBA,
    texture: material.pbrMetallicRoughness.baseColorTexture?.texture ?? null,
  }));
  const restore = () => {
    for (const { material, factor, texture } of originals) {
      material.pbrMetallicRoughness.setBaseColorFactor([...factor]);
      material.pbrMetallicRoughness.baseColorTexture?.setTexture(texture);
    }
  };
  return {
    restore,
    apply(overrides: MaterialColorOverride[] = []) {
      const targets = resolveOverrides(originals.map(entry => entry.material), overrides);
      restore();
      for (const { material, color } of targets) {
        // Solid color replaces the wood/albedo texture. This permits white and
        // keeps automatically generated Quick Look USDZ colors faithful.
        material.pbrMetallicRoughness.baseColorTexture?.setTexture(null);
        material.pbrMetallicRoughness.setBaseColorFactor(color);
      }
    },
  };
}

/** Object3D.clone shares materials. Clone them once per placed object, preserving
 * sharing within that object and keeping geometry and all texture data intact. */
export function cloneModelMaterials<T extends Object3D>(source: T): T {
  const object = source.clone(true);
  const copies = new Map<Material, Material>();
  const copy = (material: Material) => {
    let cloned = copies.get(material);
    if (!cloned) { cloned = material.clone(); copies.set(material, cloned); }
    return cloned;
  };
  object.traverse(node => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material);
  });
  return object;
}

/** Retains the original color/map so repeated changes never accumulate a tint. */
export function createThreeColorController(object: Object3D) {
  const materials = new Set<ColorMaterial>();
  object.traverse(node => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    for (const candidate of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const material = candidate as ColorMaterial;
      if (material.color?.isColor && 'map' in material) materials.add(material);
    }
  });
  const originals = [...materials].map(material => ({ material, color: material.color.clone(), map: material.map }));
  const restore = () => {
    for (const { material, color, map } of originals) {
      material.color.copy(color);
      material.map = map;
      material.needsUpdate = true;
    }
  };
  return {
    restore,
    apply(overrides: MaterialColorOverride[] = []) {
      const targets = resolveOverrides([...materials], overrides);
      restore();
      for (const { material, color } of targets) {
        // Color.set converts this CSS sRGB color to Three's linear color space.
        material.color.set(color);
        material.map = null;
        material.needsUpdate = true;
      }
    },
  };
}
