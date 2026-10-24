import type { PlacedItem, RoomLayout } from './workspace';

export type Point = { x: number; z: number };
export type Confidence = 'high' | 'medium' | 'low' | 'unknown';
export interface ScanWall { id: string; start: Point; end: Point; height: number; confidence: Confidence }
export interface ScanOpening extends ScanWall { kind: 'door' | 'window' | 'opening' }
export interface RoomObstacle extends Point {
  id: string; name: string; category: string; width: number; depth: number;
  height: number; rotation: number; confidence: Confidence;
}
export interface RoomSurvey {
  source: 'apple-roomplan'; capturedAt: string; walls: ScanWall[];
  openings: ScanOpening[]; obstacles: RoomObstacle[];
}
export interface ImportedRoom { name: string; width: number; depth: number; survey: RoomSurvey }
export const MAX_SCAN_BYTES = 512_000;
const fail = (): never => { throw new Error('This room file is incomplete or unsupported. Export a new scan from Furniture AR Scan.'); };
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail();
const number = (v: unknown, min: number, max: number): number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail();
const label = (v: unknown, max = 80): string => typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v.trim() : fail();
const confidence = (v: unknown): Confidence => ['high', 'medium', 'low', 'unknown'].includes(String(v)) ? v as Confidence : fail();
const point = (v: unknown): Point => { const p = record(v); return { x: number(p.x, -100, 100), z: number(p.z, -100, 100) }; };
function list<T>(value: unknown, read: (v: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 200) return fail();
  return value.map(read);
}
function wall(value: unknown): ScanWall {
  const v = record(value), start = point(v.start), end = point(v.end);
  if (Math.hypot(end.x - start.x, end.z - start.z) < .02) return fail();
  return { id: label(v.id), start, end, height: number(v.height, .02, 12), confidence: confidence(v.confidence) };
}
export function parseObstacle(value: unknown): RoomObstacle {
  const v = record(value);
  return { id: label(v.id), name: label(v.name, 60), category: label(v.category, 40),
    ...point(v), width: number(v.width, .02, 20), depth: number(v.depth, .02, 20),
    height: number(v.height, .02, 12), rotation: number(v.rotation, -360, 360), confidence: confidence(v.confidence) };
}
export function parseSurvey(value: unknown): RoomSurvey {
  const v = record(value);
  if (v.source !== 'apple-roomplan' || typeof v.capturedAt !== 'string' || !Number.isFinite(Date.parse(v.capturedAt))) return fail();
  const walls = list(v.walls, wall), obstacles = list(v.obstacles, parseObstacle);
  const openings = list(v.openings, value => {
    const o = record(value);
    if (!['door', 'window', 'opening'].includes(String(o.kind))) return fail();
    return { ...wall(o), kind: o.kind as ScanOpening['kind'] };
  });
  if (walls.length < 2) return fail();
  const ids = [...walls, ...openings, ...obstacles].map(v => v.id);
  if (new Set(ids).size !== ids.length) return fail();
  return { source: 'apple-roomplan', capturedAt: v.capturedAt, walls, openings, obstacles };
}
/** One shared X/Z ground plane, in metres. Recenter every layer together. */
export function parseRoomScan(raw: unknown): ImportedRoom {
  const v = record(raw);
  if (v.format !== 'furniture-ar-room' || v.version !== 1 || v.units !== 'meters') return fail();
  const survey = parseSurvey(v), points = survey.walls.flatMap(w => [w.start, w.end]);
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minZ = Math.min(...points.map(p => p.z)), maxZ = Math.max(...points.map(p => p.z));
  const width = maxX - minX, depth = maxZ - minZ;
  if (width < 1 || depth < 1 || width > 20 || depth > 20) throw new Error('Scan a complete room between 1 and 20 metres across. This scan has an incomplete or oversized outline.');
  const center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  const shift = (p: Point): Point => ({ x: p.x - center.x, z: p.z - center.z });
  return { name: label(v.name), width, depth, survey: { ...survey,
    walls: survey.walls.map(w => ({ ...w, start: shift(w.start), end: shift(w.end) })),
    openings: survey.openings.map(w => ({ ...w, start: shift(w.start), end: shift(w.end) })),
    obstacles: survey.obstacles.map(o => ({ ...o, ...shift(o) })) } };
}
export function readRoomScanText(text: string): ImportedRoom {
  if (new TextEncoder().encode(text).length > MAX_SCAN_BYTES) throw new Error('This file is too large. Choose the room JSON exported by Furniture AR Scan.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('This isn’t a room JSON file. Choose the file exported by Furniture AR Scan.'); }
  return parseRoomScan(value);
}
export function readRoomScanFragment(hash: string): ImportedRoom | undefined {
  if(!hash.startsWith('#room-scan='))return undefined;
  const encoded=hash.slice('#room-scan='.length);
  if(encoded.length>MAX_SCAN_BYTES*1.4||!/^[A-Za-z0-9_-]+={0,2}$/.test(encoded))throw new Error('This scan link is incomplete. Import the exported room file instead.');
  try{
    const bytes=Uint8Array.from(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    return readRoomScanText(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{throw new Error('This scan link is incomplete or unsupported. Import the exported room file instead.');}
}
type Footprint = Point & { width: number; depth: number; rotation: number };
export function footprintCorners(o: Footprint): Point[] {
  const a = o.rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z]) => ({
    x: o.x + x * o.width / 2 * c - z * o.depth / 2 * s,
    z: o.z + x * o.width / 2 * s + z * o.depth / 2 * c,
  }));
}
function polygonsOverlap(a: Point[], b: Point[]): boolean {
  for (const polygon of [a,b]) for (let i=0; i<polygon.length; i++) {
    const p=polygon[i], q=polygon[(i+1)%polygon.length], axis={x:-(q.z-p.z),z:q.x-p.x};
    const project=(points:Point[])=>points.map(v=>v.x*axis.x+v.z*axis.z);
    const aa=project(a), bb=project(b);
    // Touching edges are allowed; this is an overlap check, not a clearance guarantee.
    if (Math.max(...aa) <= Math.min(...bb)+1e-8 || Math.max(...bb) <= Math.min(...aa)+1e-8) return false;
  }
  return true;
}
function itemPolygon(item: PlacedItem): Point[] {
  const dims=item.product.dimensions;
  if(item.product.footprint!=='ellipse')return footprintCorners({...item,...dims});
  const angle=item.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  return Array.from({length:32},(_,i)=>{const t=i*Math.PI/16,x=Math.cos(t)*dims.width/2,z=Math.sin(t)*dims.depth/2;return{x:item.x+x*c-z*s,z:item.z+x*s+z*c};});
}
function segmentBox(w: ScanWall, thickness: number): Point[] {
  return footprintCorners({x:(w.start.x+w.end.x)/2,z:(w.start.z+w.end.z)/2,
    width:Math.hypot(w.end.x-w.start.x,w.end.z-w.start.z),depth:thickness,
    rotation:Math.atan2(w.end.z-w.start.z,w.end.x-w.start.x)*180/Math.PI});
}
/** Cut actual openings out of wall segments, so an open doorway is not a solid wall. */
export function solidWallSegments(wall: ScanWall, openings: ScanOpening[]): ScanWall[] {
  const dx=wall.end.x-wall.start.x,dz=wall.end.z-wall.start.z,length=Math.hypot(dx,dz);
  const project=(p:Point)=>((p.x-wall.start.x)*dx+(p.z-wall.start.z)*dz)/(length*length);
  const distance=(p:Point)=>Math.abs(dx*(wall.start.z-p.z)-(wall.start.x-p.x)*dz)/length;
  const cuts=openings.filter(o=>o.kind!=='window'&&distance(o.start)<.18&&distance(o.end)<.18)
    .map(o=>[Math.max(0,Math.min(project(o.start),project(o.end))),Math.min(1,Math.max(project(o.start),project(o.end)))])
    .filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
  const segments:ScanWall[]=[];let cursor=0;
  const part=(a:number,b:number)=>({...wall,start:{x:wall.start.x+dx*a,z:wall.start.z+dz*a},end:{x:wall.start.x+dx*b,z:wall.start.z+dz*b}});
  for(const [a,b] of cuts){if(a>cursor)segments.push(part(cursor,a));cursor=Math.max(cursor,b);}
  if(cursor<1)segments.push(part(cursor,1));
  return segments;
}
export function placementWarnings(item: PlacedItem, layout: RoomLayout): string[] {
  if(!layout.survey)return [];
  const polygon=itemPolygon(item),survey=layout.survey,messages:string[]=[];
  if(survey.obstacles.some(obstacle=>polygonsOverlap(polygon,footprintCorners(obstacle))))messages.push('Overlaps an existing object');
  if(survey.walls.some(w=>solidWallSegments(w,survey.openings).some(segment=>polygonsOverlap(polygon,segmentBox(segment,.10)))))messages.push('Crosses a scanned wall');
  if(survey.openings.some(o=>o.kind!=='window'&&polygonsOverlap(polygon,segmentBox(o,.9))))messages.push('Near a doorway — check access');
  return messages;
}
