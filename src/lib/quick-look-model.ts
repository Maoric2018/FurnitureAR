import type { Object3D } from 'three';
// Keep the addons import: Vite redirects model-viewer's examples/jsm import to
// this wrapper, while this specifier continues to resolve the upstream exporter.
import { USDZExporter as ThreeUSDZExporter } from 'three/addons/exporters/USDZExporter.js';
import type { USDZExporterOptions } from 'three/addons/exporters/USDZExporter.js';
import { strToU8, unzipSync, zipSync } from 'three/addons/libs/fflate.module.js';
import type { Zippable } from 'three/addons/libs/fflate.module.js';

/** Keep materials in the default prim, so Apple's referenced AR asset retains
 * both mesh bindings and shader connections when /Root is placed in a scene. */
export function scopeQuickLookMaterials(archive: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const files = unzipSync(archive);
  if (!files['model.usda']) throw new Error('The AR export is missing its model.');
  const stage = new TextDecoder().decode(files['model.usda']);
  const marker = '\n\ndef "Materials"';
  const split = stage.indexOf(marker);
  if (split < 0) {
    // Permit a future upstream exporter that already scopes its materials.
    if (/\n\s+def(?: Scope)? "Materials"/.test(stage) && !stage.includes('</Materials/')) return archive;
    throw new Error('This model’s AR materials could not be prepared. Please try again.');
  }
  const root = stage.slice(0, split).trimEnd();
  if (!root.endsWith('}') || !stage.includes('defaultPrim = "Root"')) {
    throw new Error('This model’s AR material structure could not be read.');
  }
  const materials = stage.slice(split).trim().split('\n').map(line => `\t${line}`).join('\n');
  files['model.usda'] = strToU8(`${root.slice(0, -1)}\n${materials}\n}\n`.replaceAll('</Materials/', '</Root/Materials/'));

  // USDZ requires stored entries with each payload starting on a 64-byte
  // boundary. Rebuild padding after changing the root stage's byte length.
  const entries: Zippable = {};
  let offset = 0;
  for (const name of ['model.usda', ...Object.keys(files).filter(name => name !== 'model.usda')]) {
    const bytes = files[name];
    const headerSize = 30 + strToU8(name).length;
    const padding = (64 - ((offset + headerSize + 4) % 64)) % 64;
    entries[name] = [bytes, { extra: { 12345: new Uint8Array(padding) } }];
    offset += headerSize + 4 + padding + bytes.length;
  }
  return zipSync(entries, { level: 0 });
}

/** The scoped Vite alias makes model-viewer's automatic Quick Look conversion
 * use this exporter for layouts, individual products, and generated models. */
export class USDZExporter extends ThreeUSDZExporter {
  override async parseAsync(scene: Object3D, options?: USDZExporterOptions): Promise<Uint8Array<ArrayBuffer>> {
    return scopeQuickLookMaterials(await super.parseAsync(scene, options));
  }
}

export async function exportQuickLookModel(scene: Object3D, options?: USDZExporterOptions) {
  return new USDZExporter().parseAsync(scene, options);
}
