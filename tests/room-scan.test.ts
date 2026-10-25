import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRoomScan, parseSurvey, footprintCorners, readRoomScanText, readRoomScanFragment, placementWarnings, solidWallSegments, MAX_SCAN_BYTES } from '../src/lib/room-scan.ts';
import type { Point, RoomSurvey } from '../src/lib/room-scan.ts';
import { createLayout, createProductItem, duplicateLayout, parseWorkspace, placeItem } from '../src/lib/workspace.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/room-scan.json',import.meta.url),'utf8'));
const makeRoom=()=>{const scan=parseRoomScan(fixture);return {...createLayout(scan.name,'Scanned room',scan.width,scan.depth),survey:scan.survey};};
const product=()=>({...createProductItem('https://example.com/product'),x:0,z:0,rotation:0});
const near=(actual:number,expected:number,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} should be near ${expected}`);
const nearPoint=(actual:Point,expected:Point)=>{near(actual.x,expected.x);near(actual.z,expected.z);};
function rotatedScan(input:typeof fixture,degrees:number) {
  const angle=degrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const rotate=(p:Point)=>({x:p.x*c-p.z*s,z:p.x*s+p.z*c});
  return {...structuredClone(input),
    walls:input.walls.map((w:RoomSurvey['walls'][number])=>({...w,start:rotate(w.start),end:rotate(w.end)})),
    openings:input.openings.map((o:RoomSurvey['openings'][number])=>({...o,start:rotate(o.start),end:rotate(o.end)})),
    obstacles:input.obstacles.map((o:RoomSurvey['obstacles'][number])=>({...o,...rotate(o),rotation:((o.rotation+degrees+180)%360+360)%360-180})),
  };
}

test('Import aligns a rotated room and moves walls, openings, and object footprints as one rigid scene',()=>{
  const expected=parseRoomScan(fixture);
  for(const angle of [-43,-31,1,28,44]) {
    const input=rotatedScan(fixture,angle),unchanged=structuredClone(input),room=parseRoomScan(input);
    near(room.width,5);near(room.depth,4);
    for(const kind of ['walls','openings'] as const)room.survey[kind].forEach((wall,index)=>{
      nearPoint(wall.start,expected.survey[kind][index].start);nearPoint(wall.end,expected.survey[kind][index].end);
      near(Math.hypot(wall.end.x-wall.start.x,wall.end.z-wall.start.z),Math.hypot(input[kind][index].end.x-input[kind][index].start.x,input[kind][index].end.z-input[kind][index].start.z));
    });
    room.survey.obstacles.forEach((object,index)=>{
      nearPoint(object,expected.survey.obstacles[index]);near(object.rotation,expected.survey.obstacles[index].rotation);
      assert.equal(object.width,expected.survey.obstacles[index].width);assert.equal(object.depth,expected.survey.obstacles[index].depth);
      footprintCorners(object).forEach((corner,i)=>nearPoint(corner,footprintCorners(expected.survey.obstacles[index])[i]));
    });
    assert.deepEqual(input,unchanged);
  }
});
test('Axis alignment chooses the nearest quarter turn and is independent of wall order and endpoint direction',()=>{
  const input=rotatedScan(fixture,88),room=parseRoomScan(input);
  near(room.width,4);near(room.depth,5);
  nearPoint(room.survey.walls[0].start,{x:2,z:-2.5});
  near(room.survey.obstacles[0].rotation,90);
  const reversed={...input,walls:[...input.walls].reverse().map(wall=>({...wall,start:wall.end,end:wall.start}))};
  const reordered=parseRoomScan(reversed);
  near(reordered.width,room.width);near(reordered.depth,room.depth);
  room.survey.obstacles.forEach((object,index)=>{nearPoint(object,reordered.survey.obstacles[index]);near(object.rotation,reordered.survey.obstacles[index].rotation);});
});
test('Dominant walls align an L-shaped room while preserving its diagonal corner',()=>{
  const points=[{x:0,z:0},{x:6,z:0},{x:6,z:2},{x:3,z:2},{x:3,z:4},{x:2,z:5},{x:0,z:5}];
  const input={...fixture,walls:points.map((start,index)=>({id:`wall-${index}`,start,end:points[(index+1)%points.length],height:2.7,confidence:'high'})),openings:[],obstacles:[]};
  const room=parseRoomScan(rotatedScan(input,33));
  near(room.width,6);near(room.depth,5);
  room.survey.walls.forEach((wall,index)=>{
    nearPoint(wall.start,{x:points[index].x-3,z:points[index].z-2.5});
    nearPoint(wall.end,{x:points[(index+1)%points.length].x-3,z:points[(index+1)%points.length].z-2.5});
  });
  near(Math.abs(room.survey.walls[4].end.x-room.survey.walls[4].start.x),1);
  near(Math.abs(room.survey.walls[4].end.z-room.survey.walls[4].start.z),1);
});
test('Small scan noise is averaged while a low-confidence diagonal wall is excluded from the main axes',()=>{
  const input=structuredClone(fixture);
  input.walls=input.walls.map((wall:RoomSurvey['walls'][number],index:number)=>{
    const center={x:(wall.start.x+wall.end.x)/2,z:(wall.start.z+wall.end.z)/2};
    const angle=(index<2?1:-1)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    const turn=(p:Point)=>({x:center.x+(p.x-center.x)*c-(p.z-center.z)*s,z:center.z+(p.x-center.x)*s+(p.z-center.z)*c});
    return {...wall,start:turn(wall.start),end:turn(wall.end)};
  });
  input.walls.push({id:'bay',start:{x:9,z:19},end:{x:12,z:21},height:2.7,confidence:'low'});
  const room=parseRoomScan(rotatedScan(input,27));
  near(room.survey.obstacles[0].rotation,0);
  near(Math.atan2(room.survey.walls[0].end.z-room.survey.walls[0].start.z,room.survey.walls[0].end.x-room.survey.walls[0].start.x)*180/Math.PI,1);
  // No per-wall snapping: the measured diagonal and the noisy ±1° walls survive.
  near(Math.atan2(room.survey.walls[4].end.z-room.survey.walls[4].start.z,room.survey.walls[4].end.x-room.survey.walls[4].start.x),Math.atan2(2,3));
});
test('Room size limits apply after orientation, with floating point tolerance only at the limits',()=>{
  const rectangle=(width:number,depth:number)=>({...fixture,walls:[
    {x:0,z:0},{x:width,z:0},{x:width,z:depth},{x:0,z:depth},
  ].map((start,index,points)=>({id:`wall-${index}`,start,end:points[(index+1)%4],height:2.7,confidence:'high'})),openings:[],obstacles:[]});
  const large=parseRoomScan(rotatedScan(rectangle(20,20),32));
  assert.equal(large.width,20);assert.equal(large.depth,20);
  const small=parseRoomScan(rotatedScan(rectangle(1,1),32));
  assert.equal(small.width,1);assert.equal(small.depth,1);
  assert.throws(()=>parseRoomScan(rotatedScan(rectangle(20.01,2),32)),/oversized/);
  assert.throws(()=>parseRoomScan(rotatedScan(rectangle(.99,2),32)),/incomplete/);
});
test('Aligned imports keep doorway cutouts, collision warnings, and scan identity through persistence',()=>{
  const scanId='0fd3d6b7-9107-4310-9cec-f9f3d470692e';
  const scan=parseRoomScan({...rotatedScan(fixture,37),scanId});
  const room={...createLayout(scan.name,'Scanned room',scan.width,scan.depth),survey:scan.survey};
  assert.equal(room.survey.scanId,scanId);
  assert.equal(solidWallSegments(room.survey.walls[2],room.survey.openings).length,2);
  const small={...product(),z:2,product:{...product().product,footprint:'rectangle' as const,dimensions:{width:.4,depth:.4,height:.5}}};
  assert.ok(placementWarnings(small,room).includes('Near a doorway — check access'));
  assert.ok(!placementWarnings(small,room).includes('Crosses a scanned wall'));
  assert.ok(placementWarnings({...small,x:-1.1,z:-1.35},room).includes('Overlaps an existing object'));
  assert.deepEqual(parseWorkspace({layouts:[room],items:[]}).layouts[0],room);
  // Legacy saved layouts already contain placed products: reading them must not rotate them.
  const oldSurvey=parseSurvey(rotatedScan(fixture,37));
  assert.deepEqual(oldSurvey.walls,rotatedScan(fixture,37).walls);
});

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
  assert.ok(placementWarnings({...product(),x:-1.1,z:-1.35},room).includes('Overlaps an existing object'));
  assert.ok(placementWarnings({...product(),x:2.05,z:-.8},room).includes('Overlaps an existing object'));
  assert.ok(placementWarnings({...product(),x:-1.8,z:1.2},room).includes('Overlaps an existing object'));
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
