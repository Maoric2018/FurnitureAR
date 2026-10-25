import type { Object3D } from 'three';
// Keep the addons import: Vite redirects model-viewer's examples/jsm import to
// this wrapper, while this specifier continues to resolve the upstream exporter.
import { USDZExporter as ThreeUSDZExporter } from 'three/addons/exporters/USDZExporter.js';
import type { USDZExporterOptions } from 'three/addons/exporters/USDZExporter.js';
import { strToU8, unzipSync, zipSync } from 'three/addons/libs/fflate.module.js';
import type { Zippable } from 'three/addons/libs/fflate.module.js';

/** Keep materials inside the active scene, not just the file's default prim.
 * Object view can read /Root while AR imports /Root/Scenes/Scene separately.
 * References outside that scene are discarded and become white surfaces.
 * https://developer.apple.com/documentation/usd/scenelibrary */
export function scopeQuickLookMaterials(archive: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const files = unzipSync(archive);
  if (!files['model.usda']) throw new Error('The AR export is missing its model.');
  const stage = new TextDecoder().decode(files['model.usda']);
  const marker = '\n\ndef "Materials"';
  const split = stage.indexOf(marker);
  if (split < 0) {
    // Permit a future upstream exporter that already scopes its materials to
    // the active scene. Root-only scope is insufficient for AR scene import.
    if (/\n\t{3}def(?: Scope)? "Materials"/.test(stage)
      && !stage.includes('</Materials/') && !stage.includes('</Root/Materials/')) return archive;
    throw new Error('This model’s AR materials could not be prepared. Please try again.');
  }
  const root = stage.slice(0, split).trimEnd();
  // Three's exporter writes one active Scene inside a sceneLibrary. Validate
  // this known structure before inserting; never silently repair a new layout
  // into the wrong scope after an upstream exporter change.
  const sceneEnd = '\n\t\t}\n\t}\n}';
  if (!root.endsWith(sceneEnd) || !stage.includes('defaultPrim = "Root"')
    || !root.includes('kind = "sceneLibrary"') || !root.includes('\n\t\tdef Xform "Scene"')) {
    throw new Error('This model’s AR material structure could not be read.');
  }
  const materials = stage.slice(split).trim().split('\n').map(line => `\t\t\t${line}`).join('\n');
  files['model.usda'] = strToU8(`${root.slice(0, -sceneEnd.length)}\n\n${materials}${sceneEnd}\n`
    .replaceAll('</Materials/', '</Root/Scenes/Scene/Materials/'));

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
