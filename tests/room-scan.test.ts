import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRoomScan, readRoomScanText, readRoomScanFragment, placementWarnings, solidWallSegments, MAX_SCAN_BYTES } from '../src/lib/room-scan.ts';
import { createLayout, createProductItem, duplicateLayout, parseWorkspace, placeItem } from '../src/lib/workspace.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/room-scan.json',import.meta.url),'utf8'));
const makeRoom=()=>{const scan=parseRoomScan(fixture);return {...createLayout(scan.name,'Scanned room',scan.width,scan.depth),survey:scan.survey};};
const product=()=>({...createProductItem('https://example.com/product'),x:0,z:0,rotation:0});

test('RoomPlan import recenters walls, openings and furniture together without changing metres or rotation',()=>{
  const original=structuredClone(fixture),room=parseRoomScan(fixture);
  assert.equal(room.width,5);assert.equal(room.depth,4);
  assert.deepEqual(room.survey.walls[0].start,{x:-2.5,z:-2});
  assert.deepEqual(room.survey.openings[0].start,{x:-.5,z:2});
  assert.ok(Math.abs(room.survey.obstacles[0].x+1.1)<1e-8);
  assert.ok(Math.abs(room.survey.obstacles[0].z+1.35)<1e-8);
  assert.equal(room.survey.obstacles[1].rotation,90);
  assert.equal(room.survey.obstacles[0].width,2.1);
  assert.deepEqual(fixture,original);
});
test('Scan import rejects wrong formats, units, nonfinite geometry, broken outlines and duplicate IDs',()=>{
  for(const mutate of [
    (x:any)=>x.version=2,(x:any)=>x.units='feet',(x:any)=>x.format='random',
    (x:any)=>x.walls=[],(x:any)=>x.walls[0].start.x=NaN,(x:any)=>x.walls[0].height=Infinity,
    (x:any)=>x.obstacles[0].width=-1,(x:any)=>x.obstacles[0].rotation=Infinity,
    (x:any)=>x.obstacles[0].id=x.walls[0].id,(x:any)=>x.openings[0].kind='script',
    (x:any)=>x.obstacles=Array(201).fill(x.obstacles[0]),(x:any)=>x.capturedAt='yesterday',
    (x:any)=>x.walls.forEach((w:any)=>{w.start.z=0;w.end.z=0;}),
  ]){const input=structuredClone(fixture);mutate(input);assert.throws(()=>parseRoomScan(input));}
  assert.throws(()=>readRoomScanText('not json'));
  assert.throws(()=>readRoomScanText(' '.repeat(MAX_SCAN_BYTES+1)));
});
test('Native Safari handoff preserves Unicode and rejects malformed or oversized fragments',()=>{
  const input={...fixture,name:'Eric’s room 家'};
  const fragment='#room-scan='+Buffer.from(JSON.stringify(input)).toString('base64url');
  assert.equal(readRoomScanFragment(fragment)?.name,input.name);
  assert.equal(readRoomScanFragment('#main-content'),undefined);
  assert.throws(()=>readRoomScanFragment('#room-scan=***'));
  assert.throws(()=>readRoomScanFragment('#room-scan='+ 'A'.repeat(MAX_SCAN_BYTES*2)));
  assert.throws(()=>readRoomScanFragment('#room-scan='+Buffer.from('{}').toString('base64url')));
});
test('Round-trip saved scans and duplicate rooms retain independent editable obstacles',()=>{
  const room=makeRoom(),workspace={layouts:[room],items:[]};
  assert.deepEqual(parseWorkspace(JSON.parse(JSON.stringify(workspace))),workspace);
  const copy=duplicateLayout(room);copy.survey!.obstacles[0].name='Changed';copy.survey!.walls[0].start.x=0;
  assert.equal(room.survey.obstacles[0].name,'Existing sofa');assert.equal(room.survey.walls[0].start.x,-2.5);
  const corrupt=structuredClone(workspace);corrupt.layouts[0].survey.obstacles[0].width=Infinity;
  assert.equal(parseWorkspace(corrupt).layouts.length,0);
  assert.equal(parseWorkspace({layouts:[createLayout('Old room')],items:[]}).layouts.length,1);
});
test('Placement detects furniture overlap and keeps the middle of the room clear',()=>{
  const room=makeRoom();assert.deepEqual(placementWarnings(product(),room),[]);
  assert.ok(placementWarnings({...product(),x:-1.1,z:-1.35},room).includes('Overlaps Existing sofa'));
  assert.ok(placementWarnings({...product(),x:2.05,z:-.8},room).includes('Overlaps Cabinet'));
  assert.ok(placementWarnings({...product(),x:-1.8,z:1.2},room).includes('Overlaps Reading chair'));
  assert.deepEqual(placementWarnings(product(),createLayout('Unscanned')),[]);
});
test('Rotated narrow furniture uses its footprint rather than a large axis-aligned box',()=>{
  const room=makeRoom();room.survey.obstacles=[{...room.survey.obstacles[0],x:0,z:0,width:3,depth:.2,rotation:45}];
  const tiny={...product(),product:{...product().product,footprint:'rectangle' as const,dimensions:{width:.1,depth:.1,height:.1}}};
  assert.ok(placementWarnings(tiny,room).some(w=>w.startsWith('Overlaps')));
  assert.deepEqual(placementWarnings({...tiny,x:.8,z:-.8},room),[]);
});
test('Door openings cut the solid wall and have a separate conservative access warning',()=>{
  const room=makeRoom(),wall=room.survey.walls[2];
  assert.equal(solidWallSegments(wall,room.survey.openings).length,2);
  const small={...product(),z:2,product:{...product().product,footprint:'rectangle' as const,dimensions:{width:.4,depth:.4,height:.5}}};
  const warnings=placementWarnings(small,room);
  assert.ok(warnings.includes('Near a doorway — check access'));
  assert.ok(!warnings.includes('Crosses a scanned wall'));
  assert.ok(placementWarnings({...small,x:1.6},room).includes('Crosses a scanned wall'));
  assert.ok(placementWarnings({...small,x:0,z:-2},room).includes('Crosses a scanned wall'));
});
test('Scanned room supports placed products and safely persists corrected furniture',()=>{
  let room=placeItem(makeRoom(),createProductItem('example.com/table'));
  room.survey!.obstacles[0]={...room.survey!.obstacles[0],name:'My sofa',width:2.2};
  const saved=parseWorkspace({layouts:[room],items:[]}).layouts[0];
  assert.equal(saved.items.length,1);assert.equal(saved.survey?.obstacles[0].name,'My sofa');
  assert.equal(saved.survey?.obstacles[0].width,2.2);
});
