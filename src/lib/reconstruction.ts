export type GenerationStatus = 'queued' | 'processing' | 'succeeded' | 'failed';
export interface GenerationJob { ticket: string; status: GenerationStatus; stage?: string; progress?: number }
export interface PendingGeneration extends GenerationJob { startedAt: number }
export interface GenerationConfig { configured: boolean; signedIn: boolean }
export class GenerationError extends Error { constructor(message: string, public code = 'REQUEST_FAILED') { super(message); } }
export const GENERATION_STORAGE_KEY = 'furniture-ar:photo-job:v1';
export function parseGenerationJob(value: unknown): GenerationJob {
  const job = value as Partial<GenerationJob> | null;
  if (!job || typeof job.ticket !== 'string' || !/^[\w-]+\.[\w-]+$/.test(job.ticket) || job.ticket.length > 800
      || !['queued', 'processing', 'succeeded', 'failed'].includes(job.status || '')
      || (job.progress !== undefined && (typeof job.progress !== 'number' || !Number.isFinite(job.progress) || job.progress < 0 || job.progress > 100))) throw new GenerationError('The generation response could not be read. Please try again.');
  return { ticket: job.ticket, status: job.status!, progress: job.progress,
    stage: typeof job.stage === 'string' && ['preparing', 'reconstructing', 'texturing', 'exporting'].includes(job.stage) ? job.stage : undefined };
}
async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`/api/reconstruction/${path}`, { ...init, signal: init.signal || AbortSignal.timeout(40000) });
  let value;
  try { value = await response.json(); } catch { throw new GenerationError('The generation service is unavailable. Please try again.'); }
  if (!response.ok) throw new GenerationError(typeof value.error?.message === 'string' ? value.error.message : 'The generation request failed.', value.error?.code);
  return value;
}
export async function generationConfig(signal?: AbortSignal): Promise<GenerationConfig> {
  const value = await request('config', { signal });
  if (typeof value.configured !== 'boolean' || typeof value.signedIn !== 'boolean') throw new GenerationError('Could not check the generation service.');
  return value;
}
export async function createGeneration(image: File, requestId: string, signal: AbortSignal): Promise<GenerationJob> {
  const body = new FormData(); body.set('image', image);
  return parseGenerationJob(await request('jobs', { method: 'POST', headers: { 'Idempotency-Key': requestId }, body, signal }));
}
export async function getGeneration(ticket: string, signal?: AbortSignal): Promise<GenerationJob> {
  return parseGenerationJob(await request(`jobs/${encodeURIComponent(ticket)}`, { signal }));
}
export function generationModelUrl(ticket: string) { return `/api/reconstruction/jobs/${encodeURIComponent(ticket)}/model`; }
/** Keep the clock attached to the job when polling replaces its status. */
export function trackGeneration(next: GenerationJob, previous: PendingGeneration | null = null, startedAt = Date.now()): PendingGeneration {
  return { ...next, startedAt: previous?.ticket === next.ticket ? previous.startedAt : startedAt };
}
export function generationElapsedSeconds(startedAt: number | null | undefined, now = Date.now()): number {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt <= 0 || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
export function readPendingGeneration(now = Date.now()): PendingGeneration | null {
  try {
    const raw = sessionStorage.getItem(GENERATION_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw), job = parseGenerationJob(value);
    const startedAt = typeof value.startedAt === 'number' && Number.isSafeInteger(value.startedAt) && value.startedAt > 0 && value.startedAt <= now ? value.startedAt : now;
    const pending = trackGeneration(job, null, startedAt);
    // Migrate older saved jobs once, so subsequent page changes keep this clock.
    if (value.startedAt !== startedAt) rememberGeneration(pending);
    return pending;
  } catch { return null; }
}
export function rememberGeneration(job: PendingGeneration | null) {
  try { if (job) sessionStorage.setItem(GENERATION_STORAGE_KEY, JSON.stringify(job)); else sessionStorage.removeItem(GENERATION_STORAGE_KEY); } catch { /* The active tab can continue without persistence. */ }
}
export function validatePhoto(file: Pick<File, 'type' | 'size'>) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new GenerationError('Choose a JPG, PNG, or WebP photo. Convert HEIC photos to JPG first.');
  if (!file.size || file.size > 20 * 1024 * 1024) throw new GenerationError('Choose a photo smaller than 20 MB.');
}
/** Decode and re-encode pixels, resizing uploads and removing original EXIF metadata. */
export async function preparePhoto(file: File): Promise<File> {
  validatePhoto(file);
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 60_000_000) throw new GenerationError('Choose a smaller photo.');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d'); if (!context) throw new Error();
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
    if (!blob || blob.size > 8 * 1024 * 1024) throw new Error();
    return new File([blob], 'furniture-photo.jpg', { type: 'image/jpeg' });
  } catch (error) { throw error instanceof GenerationError ? error : new GenerationError('This photo could not be opened. Try another JPG, PNG, or WebP image.'); }
  finally { URL.revokeObjectURL(url); }
}
