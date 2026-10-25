import { parseWorkspace } from './workspace';
import type { PlacedItem, RoomLayout } from './workspace';
import { footprintCorners, placementWarnings } from './room-scan';
import type { Point } from './room-scan';

export type PieceRule = 'fixed' | 'move' | 'remove';
export interface DesignPhoto { data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }
export interface DesignRequest {
  layout: RoomLayout; brief: string; style: string; budget: number;
  rules: Record<string, PieceRule>; photos: DesignPhoto[]; refinement?: string;
  previous?: { name: string; items: { candidateId: string; x: number; z: number; rotation: number }[] };
}
export interface DesignCandidate { id: string; item: PlacedItem; price: number | null; existing: boolean }
export interface DesignDraft { name: string; description: string; items: { candidateId: string; x: number; z: number; rotation: number }[] }
export interface DesignProposal {
  id: string; name: string; description: string; layout: RoomLayout;
  total: number; currency: 'USD'; pricingAvailable?: boolean; added: number; notes: string[]; draft: DesignDraft;
}
export interface DesignResult { summary: string; observations: string[]; proposals: DesignProposal[]; notices: string[] }
export class DesignError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
const invalid = (message = 'Check the room details and try again.'): never => { throw new DesignError('INVALID_REQUEST', message); };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number, empty = false): string => {
  if (typeof v !== 'string' || v.length > max || (!empty && !v.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) return invalid();
  return v.trim();
};
export function parseDesignRequest(value: unknown): DesignRequest {
  if (!record(value) || !record(value.layout)) return invalid();
  // Do not silently drop invalid items or clamp a locked piece during validation.
  const raw = value.layout;
  if (!Array.isArray(raw.items) || raw.items.length > 30) return invalid();
  const layout = parseWorkspace({ layouts: [raw] }).layouts[0];
  if (!layout || layout.items.length !== raw.items.length || new Set(layout.items.map(i => i.id)).size !== layout.items.length) return invalid();
  for (let i = 0; i < layout.items.length; i++) {
    const original = raw.items[i];
    if (!record(original) || original.x !== layout.items[i].x || original.z !== layout.items[i].z) return invalid('A piece sits outside the room. Move it inside before designing.');
  }
  const budget = value.budget;
  if (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 0 || budget > 100000) return invalid('Enter a budget between $0 and $100,000.');
  if (!record(value.rules) || !Array.isArray(value.photos) || value.photos.length > 4) return invalid();
  const rules: Record<string, PieceRule> = {};
  for (const item of layout.items) {
    const rule = value.rules[item.id] ?? 'fixed';
    if (!['fixed', 'move', 'remove'].includes(String(rule))) return invalid();
    rules[item.id] = rule as PieceRule;
  }
  let photoBytes = 0;
  const photos = value.photos.map((photo): DesignPhoto => {
    if (!record(photo) || !['image/jpeg', 'image/png', 'image/webp'].includes(String(photo.mediaType))
      || typeof photo.data !== 'string' || !photo.data.length || photo.data.length > 1_400_000
      || photo.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.data)) return invalid('Choose up to four JPEG, PNG, or WebP room photos.');
    photoBytes += photo.data.length;
    let bytes: string;
    try { bytes = atob(photo.data.slice(0, 32)); } catch { return invalid('One room photo could not be read.'); }
    const signature = photo.mediaType === 'image/jpeg' ? bytes.startsWith('\xff\xd8\xff')
      : photo.mediaType === 'image/png' ? bytes.startsWith('\x89PNG\r\n\x1a\n')
      : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
    if (!signature) return invalid('One room photo has an unsupported image format.');
    return { mediaType: photo.mediaType as DesignPhoto['mediaType'], data: photo.data };
  });
  if (photoBytes > 4_500_000) return invalid('The room photos are too large. Try fewer photos.');
  let previous: DesignRequest['previous'];
  if (value.previous !== undefined) {
    if (!record(value.previous) || !Array.isArray(value.previous.items) || value.previous.items.length > 30) return invalid();
    previous = { name: text(value.previous.name, 80), items: value.previous.items.map(item => {
      if (!record(item) || ![item.x, item.z, item.rotation].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 360)) return invalid();
      return { candidateId: text(item.candidateId, 100), x: item.x as number, z: item.z as number, rotation: item.rotation as number };
    }) };
  }
  return { layout, brief: text(value.brief, 1600), style: text(value.style, 100, true), budget, rules, photos,
    ...(previous ? { previous } : {}), ...(value.refinement === undefined ? {} : { refinement: text(value.refinement, 800) }) };
}

// A closed scan outline prevents placements in the empty notch of an L-shaped room.
// Refuse disconnected outlines instead of treating their bounding box as a room.
export function scanOutline(layout: RoomLayout): Point[] | null {
  if (!layout.survey) return null;
  const edges = layout.survey.walls.map(w => [w.start, w.end]);
  if (edges.length < 3) return null;
  const chain = [...edges.shift()!];
  while (edges.length) {
    const end = chain.at(-1)!;
    const index = edges.findIndex(edge => edge.some(p => Math.hypot(end.x - p.x, end.z - p.z) < .25));
    if (index < 0) return null;
    const edge = edges.splice(index, 1)[0];
    chain.push(Math.hypot(end.x - edge[0].x, end.z - edge[0].z) < .25 ? edge[1] : edge[0]);
  }
  return Math.hypot(chain[0].x - chain.at(-1)!.x, chain[0].z - chain.at(-1)!.z) < .25 ? chain.slice(0, -1) : null;
}
function inside(p: Point, polygon: Point[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) result = !result;
  }
  return result;
}
export function designPlacementValid(item: PlacedItem, room: RoomLayout, outline = scanOutline(room)): boolean {
  if (placementWarnings(item, room).length) return false;
  if (room.survey && !outline) return false;
  if (outline && !footprintCorners({ ...item, ...item.product.dimensions }).every(p => inside(p, outline))) return false;
  // Reserve a small gap between new furniture; doorway checks live in placementWarnings.
  const padded = { ...item, product: { ...item.product, dimensions: { ...item.product.dimensions,
    width: item.product.dimensions.width + .08, depth: item.product.dimensions.depth + .08 } } };
  return !placementWarnings(padded, room).some(w => w === 'Overlaps another piece' || w === 'Overlaps an existing object');
}
function placeNear(item: PlacedItem, room: RoomLayout, outline: Point[] | null): PlacedItem | null {
  if (designPlacementValid(item, room, outline)) return item;
  const options: { x: number; z: number; rotation: number; score: number }[] = [];
  const step = Math.max(.2, Math.max(room.width, room.depth) / 30);
  const rotations = [...new Set([item.rotation, 0, 90, 180, 270])];
  for (const rotation of rotations) for (let x = -room.width / 2 + .1; x < room.width / 2; x += step) {
    for (let z = -room.depth / 2 + .1; z < room.depth / 2; z += step) {
      options.push({ x, z, rotation, score: Math.hypot(item.x - x, item.z - z) + (rotation === item.rotation ? 0 : .35) });
    }
  }
  options.sort((a, b) => a.score - b.score);
  for (const p of options) {
    const next = { ...item, x: Math.round(p.x * 1000) / 1000, z: Math.round(p.z * 1000) / 1000, rotation: p.rotation };
    if (designPlacementValid(next, room, outline)) return next;
  }
  return null;
}
export function buildProposal(raw: unknown, request: DesignRequest, candidates: DesignCandidate[]): DesignProposal {
  if (!record(raw) || !Array.isArray(raw.items) || raw.items.length > 30 || !raw.items.length) throw new DesignError('INVALID_PROPOSAL', 'This design has no usable furniture. Try a more specific brief.', 422);
  const name = text(raw.name, 80), description = text(raw.description, 600);
  const catalog = new Map(candidates.map(c => [c.id, c]));
  const used = new Set<string>();
  const selections = raw.items.map(value => {
    if (!record(value) || typeof value.candidateId !== 'string' || !catalog.has(value.candidateId)
      || ![value.x, value.z, value.rotation].every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 360)) throw new DesignError('INVALID_PROPOSAL', 'The designer returned an incomplete placement.', 422);
    const candidate = catalog.get(value.candidateId)!;
    if (candidate.existing && (used.has(candidate.id) || request.rules[candidate.item.id] === 'remove')) throw new DesignError('INVALID_PROPOSAL', 'This design changed a piece that should be preserved.', 422);
    used.add(candidate.id);
    const item = candidate.existing && request.rules[candidate.item.id] === 'fixed' ? { ...candidate.item }
      : { ...candidate.item, id: candidate.existing ? candidate.item.id : crypto.randomUUID(),
        x: value.x as number, z: value.z as number, rotation: ((Math.round(value.rotation as number / 15) * 15 % 360) + 360) % 360 };
    return { candidate, item };
  });
  for (const item of request.layout.items) {
    if (request.rules[item.id] !== 'remove' && !selections.some(s => s.candidate.existing && s.item.id === item.id)) throw new DesignError('INVALID_PROPOSAL', 'The design left out a piece you wanted to keep.', 422);
  }
  const purchased = selections.filter(s => !s.candidate.existing);
  if (purchased.length > 10 || purchased.some(s => s.candidate.price === null || !Number.isFinite(s.candidate.price) || s.candidate.price! <= 0)) throw new DesignError('INVALID_PROPOSAL', 'A suggested product is missing a current price.', 422);
  const total = purchased.reduce((sum, s) => sum + Math.round(s.candidate.price! * 100), 0) / 100;
  if (Math.round(total * 100) > Math.round(request.budget * 100)) throw new DesignError('OVER_BUDGET', 'The proposed products exceed your budget.', 422);
  const room: RoomLayout = { ...structuredClone(request.layout), id: crypto.randomUUID(), name: `${request.layout.name} · ${name}`.slice(0, 80), items: [], updatedAt: new Date().toISOString() };
  const outline = scanOutline(room);
  if (room.survey && !outline) throw new DesignError('INCOMPLETE_SCAN', 'The scan does not contain a closed room outline. Use a complete scan before generating designs.', 422);
  const fixed = selections.filter(s => s.candidate.existing && request.rules[s.item.id] === 'fixed');
  room.items = fixed.map(s => s.item);
  if (room.items.some(item => !designPlacementValid(item, room, outline))) throw new DesignError('LOCKED_CONFLICT', 'A piece marked “Keep here” overlaps furniture, a wall, or a doorway. Move it or choose “Can move” first.', 422);
  let adjusted = false;
  const movable = selections.filter(s => !fixed.includes(s)).sort((a, b) => b.item.product.dimensions.width * b.item.product.dimensions.depth - a.item.product.dimensions.width * a.item.product.dimensions.depth);
  for (const selection of movable) {
    const placed = placeNear(selection.item, room, outline);
    if (!placed) throw new DesignError('NO_FIT', 'These pieces cannot fit together with the current obstacles. Try a smaller furniture selection.', 422);
    adjusted ||= placed.x !== selection.item.x || placed.z !== selection.item.z || placed.rotation !== selection.item.rotation;
    selection.item = placed; room.items.push(placed);
  }
  const notes = ['Fit checked against this floor plan. Confirm measurements and walking space before buying.'];
  if (!room.survey) notes.push('This room uses manual dimensions. Existing furniture and doorways are not mapped.');
  if (purchased.length) notes.push('Product subtotal excludes tax and delivery. Prices can change. 3D previews are approximate.');
  if (adjusted) notes.push('Some positions were adjusted to avoid collisions.');
  return { id: crypto.randomUUID(), name, description, layout: room, total, currency: 'USD', added: purchased.length, notes,
    draft: { name, description, items: selections.map(s => ({ candidateId: s.candidate.id, x: s.item.x, z: s.item.z, rotation: s.item.rotation })) } };
}
