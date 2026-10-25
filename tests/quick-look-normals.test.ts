import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Scene } from 'three';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import { exportQuickLookModel } from '../src/lib/quick-look-model.ts';

function triangle(withNormals = false) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0], 3));
  geometry.setAttribute('color', new Float32BufferAttribute([.8,.2,.1, .8,.2,.1, .8,.2,.1], 3));
  geometry.setIndex([0,1,2]);
  if (withNormals) geometry.computeVertexNormals();
  return geometry;
}

test('SAM-style meshes without normals use native faceted shading while retaining their connected colors', async () => {
  const geometry = triangle();
  const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true });
  const mesh = new Mesh(geometry, material);
  const scene = new Scene(); scene.add(mesh); scene.updateMatrixWorld(true);
  const original = JSON.stringify(geometry.toJSON());
  const files = unzipSync(await exportQuickLookModel(scene));
  const usd = new TextDecoder().decode(files[`geometries/Geometry_${geometry.id}.usda`]);
  const stage = new TextDecoder().decode(files['model.usda']);
  assert(!/normal3f\[\] normals/.test(usd), 'Absent source normals must not become zero-vector lighting normals');
  assert.match(usd, /subdivisionScheme = "none"/, 'Omitted normals require polygonal faceted shading');
  assert.match(usd, /primvars:vertexColorUV/);
  assert.match(stage, /inputs:diffuseColor.connect = <[^>]+\/VertexColorTexture_\d+\.outputs:rgb>/);
  assert.equal(JSON.stringify(geometry.toJSON()), original, 'Export must not change the browser model');
  assert.equal(mesh.geometry, geometry);
  assert.equal(mesh.material, material);
});

test('Authored normals survive alongside missing-normal meshes and shared instances', async () => {
  const smooth = triangle(true), flat = triangle();
  const material = new MeshStandardMaterial();
  const group = new Group();
  group.add(new Mesh(smooth, material), new Mesh(flat, material), new Mesh(flat, material));
  const scene = new Scene(); scene.add(group); scene.updateMatrixWorld(true);
  const before = Array.from(smooth.getAttribute('normal').array);
  const files = unzipSync(await exportQuickLookModel(scene));
  const smoothUsd = new TextDecoder().decode(files[`geometries/Geometry_${smooth.id}.usda`]);
  const flatUsd = new TextDecoder().decode(files[`geometries/Geometry_${flat.id}.usda`]);
  assert.match(smoothUsd, /normal3f\[\] normals = \[/);
  assert.match(smoothUsd, /\(0\.0+, 0\.0+, 1\.0+\)/);
  assert(!/normal3f\[\] normals/.test(flatUsd));
  assert.deepEqual(Array.from(smooth.getAttribute('normal').array), before);
  assert.equal(flat.getAttribute('normal'), undefined);
  assert.equal(Object.keys(files).filter(path => path.startsWith('geometries/')).length, 2);
});

test('Hidden missing-normal meshes respect export visibility settings', async () => {
  const geometry = triangle();
  const scene = new Scene(), hidden = new Group(); hidden.visible = false;
  hidden.add(new Mesh(geometry, new MeshStandardMaterial())); scene.add(hidden); scene.updateMatrixWorld(true);
  const visible = unzipSync(await exportQuickLookModel(scene));
  assert.equal(visible[`geometries/Geometry_${geometry.id}.usda`], undefined);
  const all = unzipSync(await exportQuickLookModel(scene, { onlyVisible: false }));
  const usd = new TextDecoder().decode(all[`geometries/Geometry_${geometry.id}.usda`]);
  assert.match(usd, /subdivisionScheme = "none"/);
  assert(!/normal3f\[\] normals/.test(usd));
});
