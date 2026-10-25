import type { DesignPhoto, DesignRequest, DesignResult, DesignProposal } from './design';
import { parseWorkspace } from './workspace';

export async function designStatus(signal?: AbortSignal): Promise<{ configured: boolean; shopping: boolean }> {
  const response = await fetch('/api/design/room', { signal, credentials: 'same-origin', redirect: 'error' });
  const value = await response.json();
  if (!response.ok || typeof value?.configured !== 'boolean' || typeof value?.shopping !== 'boolean') throw new Error('Could not check room design. Try again in a moment.');
  return value;
}
const errors: Record<string, string> = {
  DESIGN_NOT_CONFIGURED: 'Room design is waiting for its Claude connection. Your brief is saved on this device.',
  DESIGN_AUTH_FAILED: 'Claude is not available with the current service configuration. Please contact the app owner.',
  DESIGN_RATE_LIMITED: 'The design allowance has been reached. Please try again later.',
  DESIGN_BUSY: 'Other rooms are being designed. Please try again shortly.',
  DESIGN_TIMEOUT: 'The design took too long. Your layout is unchanged; please try again.',
  NO_PRODUCTS: 'No suitable products with prices and 3D previews were found. Try a different brief or add products to your layout first.',
  INCOMPLETE_SCAN: 'This room scan needs a complete outline before it can be designed.',
  NO_VALID_DESIGNS: 'No proposal passed the fit checks. Try fewer pieces, smaller furniture, or let existing pieces move.',
  TOO_LARGE: 'The room photos are too large. Try fewer or smaller images.',
};
export function parseDesignResult(value: unknown): DesignResult {
  const data = value as DesignResult;
  const strings = (v: unknown, count: number) => Array.isArray(v) && v.length <= count && v.every(s => typeof s === 'string' && s.length <= 1000);
  if (!data || typeof data.summary !== 'string' || data.summary.length > 1000 || !strings(data.observations, 5) || !strings(data.notices, 12)
    || !Array.isArray(data.proposals) || !data.proposals.length || data.proposals.length > 3) throw new Error('The designer returned incomplete results. Please try again.');
  const proposals = data.proposals.map((p): DesignProposal => {
    const layout = parseWorkspace({ layouts: [p.layout] }).layouts[0];
    if (!layout || layout.items.length !== p.layout.items.length || !layout.items.length || typeof p.id !== 'string'
      || typeof p.name !== 'string' || p.name.length > 80 || typeof p.description !== 'string' || p.description.length > 600
      || !Number.isFinite(p.total) || p.total < 0 || p.currency !== 'USD' || !Number.isInteger(p.added) || p.added < 0
      || !strings(p.notes, 10) || !p.draft || !Array.isArray(p.draft.items) || p.draft.items.length > 30
      || p.draft.items.some(i => typeof i.candidateId !== 'string' || ![i.x, i.z, i.rotation].every(Number.isFinite))) throw new Error('The designer returned an incomplete layout. Please try again.');
    return { ...p, layout };
  });
  return { summary: data.summary, observations: data.observations, notices: data.notices, proposals };
}
export async function requestDesign(input: DesignRequest, signal: AbortSignal): Promise<DesignResult> {
  let response: Response;
  try { response = await fetch('/api/design/room', { method: 'POST', credentials: 'same-origin', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); }
  catch { signal.throwIfAborted(); throw new Error('Could not reach the designer. Check your connection and try again.'); }
  let value;
  try { value = await response.json(); } catch { signal.throwIfAborted(); throw new Error('The designer returned an unreadable response. Please try again.'); }
  signal.throwIfAborted();
  if (!response.ok) throw new Error(errors[value?.error?.code] ?? 'The design could not be completed. Try again with a more specific brief.');
  return parseDesignResult(value);
}
/** Re-encode to strip metadata and keep four photos within the request budget. */
export async function prepareRoomPhoto(file: File): Promise<DesignPhoto> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20_000_000) throw new Error('Choose a JPEG, PNG, or WebP photo under 20 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 60_000_000) throw new Error('This photo is too large. Choose a smaller image.');
    const ratio = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * ratio); canvas.height = Math.round(image.naturalHeight * ratio);
    const context = canvas.getContext('2d'); if (!context) throw new Error('Your browser could not prepare the photo.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', .78).split(',')[1];
    if (data.length > 1_100_000) throw new Error('This photo is still too large. Try a smaller image.');
    return { mediaType: 'image/jpeg', data };
  } finally { URL.revokeObjectURL(url); }
}
