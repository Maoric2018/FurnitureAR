import test from 'node:test';
import assert from 'node:assert/strict';
import { createUrbanDemoProposal } from '../src/lib/urban-demo.ts';
import { isUrbanLayout, parseWorkspace } from '../src/lib/workspace.ts';

test('previously saved app labels migrate without changing layout identity, geometry or product links',()=>{
  const old=createUrbanDemoProposal().layout;
  old.name='Urban High-Rise · Demo copy';old.roomType='Demo · urban high-rise';
  old.items[0].product={...old.items[0].product,tagline:'Urban High-Rise demo selection',description:'Original product-inspired 3D approximation for the prepared demonstration. Confirm measurements and availability on the Amazon listing.'};
  const snapshot=structuredClone(old);
  const clean=parseWorkspace({layouts:[old]}).layouts[0];
  assert.equal(clean.name,'Urban High-Rise · Gallery Retreat copy');
  assert.equal(clean.roomType,'Urban high-rise');assert.ok(isUrbanLayout(clean));
  assert.equal(clean.id,old.id);assert.equal(clean.updatedAt,old.updatedAt);
  assert.deepEqual(clean.survey,old.survey);
  const placements=(room:typeof old)=>room.items.map(({id,x,z,rotation,elevation,sourceUrl,variantId})=>({id,x,z,rotation,elevation,sourceUrl,variantId}));
  assert.deepEqual(placements(clean),placements(old));
  assert.equal(clean.items[0].product.tagline,'Urban High-Rise selection');
  assert.doesNotMatch(clean.items[0].product.description,/demo|prepared/i);
  assert.deepEqual(old,snapshot,'Reading a saved room must not mutate the input');
  assert.deepEqual(parseWorkspace({layouts:[clean]}).layouts[0],clean,'Migration is idempotent');
});

test('label migration preserves user names and custom product copy',()=>{
  const room=createUrbanDemoProposal().layout;
  room.name='My presentation room';room.roomType='Demo · urban high-rise';
  room.items[0].product={...room.items[0].product,tagline:'My rug selection',description:'Custom notes'};
  const clean=parseWorkspace({layouts:[room]}).layouts[0];
  assert.equal(clean.name,room.name);assert.equal(clean.items[0].product.tagline,'My rug selection');
  assert.equal(clean.items[0].product.description,'Custom notes');
  const scanned={...room,name:'Urban High-Rise · Scanned room',roomType:'Demo · scanned room',items:[]};
  assert.equal(parseWorkspace({layouts:[scanned]}).layouts[0].roomType,'Scanned room');
});
