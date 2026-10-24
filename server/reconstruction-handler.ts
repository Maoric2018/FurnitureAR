/** Provider adapter for asynchronous image-to-3D services. See PHOTO_TO_3D.md. */
export interface ReconstructionEnv { MODEL_API_URL?: string; MODEL_API_KEY?: string }
type JobStatus = 'queued' | 'processing' | 'succeeded' | 'failed';
export interface ProviderJob { id: string; status: JobStatus; progress?: number; stage?: string }
const IMAGE_LIMIT = 8 * 1024 * 1024;
const MODEL_LIMIT = 25 * 1024 * 1024;
const stages = new Set(['preparing', 'reconstructing', 'texturing', 'exporting']);
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const encoder = new TextEncoder();
class ServiceError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export function configuration(env: ReconstructionEnv) {
  if (!env.MODEL_API_URL || !env.MODEL_API_KEY) return null;
  try {
    const url = new URL(env.MODEL_API_URL);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) return null;
    return { base: url.href.replace(/\/$/, ''), key: env.MODEL_API_KEY };
  } catch { return null; }
}
export async function readLimited(response: Pick<Response, 'body' | 'headers'>, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(response.headers.get('Content-Length')) > limit) throw new ServiceError(413, 'TOO_LARGE', 'This file is too large. Please choose a smaller file.');
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) throw new ServiceError(413, 'TOO_LARGE', 'This file is too large. Please choose a smaller file.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export function parseProviderJob(value: unknown): ProviderJob {
  const job = value as Partial<ProviderJob> | null;
  if (!job || typeof job.id !== 'string' || !idPattern.test(job.id) || !['queued', 'processing', 'succeeded', 'failed'].includes(job.status || '')
    || (job.progress !== undefined && (typeof job.progress !== 'number' || !Number.isFinite(job.progress) || job.progress < 0 || job.progress > 100))) {
    throw new ServiceError(502, 'INVALID_JOB', 'The 3D service returned an unreadable job. Please try again later.');
  }
  return { id: job.id, status: job.status!, ...(job.progress !== undefined ? { progress: job.progress } : {}),
    ...(typeof job.stage === 'string' && stages.has(job.stage) ? { stage: job.stage } : {}) };
}
function base64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unbase64(value: string) { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
async function signingKey(secret: string) { return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
async function issueTicket(id: string, user: string, secret: string, now: number) {
  const payload = base64(encoder.encode(JSON.stringify({ id, expires: now + 24 * 60 * 60 * 1000 })));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(`${user}:${payload}`));
  return `${payload}.${base64(new Uint8Array(signature))}`;
}
async function readTicket(ticket: string, user: string, secret: string, now: number): Promise<string> {
  try {
    if (ticket.length > 800 || !/^[\w-]+\.[\w-]+$/.test(ticket)) throw new Error();
    const [payload, signature] = ticket.split('.');
    if (!await crypto.subtle.verify('HMAC', await signingKey(secret), unbase64(signature), encoder.encode(`${user}:${payload}`))) throw new Error();
    const data = JSON.parse(new TextDecoder().decode(unbase64(payload)));
    if (!idPattern.test(data.id) || !Number.isFinite(data.expires) || data.expires <= now) throw new Error();
    return data.id;
  } catch { throw new ServiceError(404, 'JOB_UNAVAILABLE', 'This generation is unavailable or has expired. Start a new photo.'); }
}
export function createReconstructionHandler({ fetchImpl = fetch, now = Date.now } = {}) {
  const attempts = new Map<string, { count: number; until: number }>();
  return async (request: Request, env: ReconstructionEnv): Promise<Response> => {
    try {
      const url = new URL(request.url), config = configuration(env), user = request.headers.get('oai-authenticated-user-id');
      if (url.pathname === '/api/reconstruction/config' && request.method === 'GET') return json({ configured: !!config, signedIn: !!user });
      const match = url.pathname.match(/^\/api\/reconstruction\/jobs(?:\/([\w.-]+)(\/model)?)?$/);
      if (!match) throw new ServiceError(404, 'NOT_FOUND', 'Not found.');
      if (request.method !== (match[1] ? 'GET' : 'POST')) throw new ServiceError(405, 'METHOD_NOT_ALLOWED', 'This action is not supported.');
      if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) throw new ServiceError(403, 'ORIGIN_NOT_ALLOWED', 'Open Furniture AR to create a model.');
      if (!user) throw new ServiceError(401, 'SIGN_IN_REQUIRED', 'Sign in before sending your photo for 3D generation.');
      if (!config) throw new ServiceError(503, 'MODEL_NOT_CONFIGURED', '3D generation is not connected yet. Your photo has not been sent.');
      let id: string | undefined, body: FormData | undefined;
      const headers: Record<string, string> = { Authorization: `Bearer ${config.key}`, 'X-Furniture-User': user };
      if (match[1]) id = await readTicket(match[1], user, config.key, now());
      else {
        if (!request.headers.get('Content-Type')?.startsWith('multipart/form-data;')) throw new ServiceError(415, 'INVALID_IMAGE', 'Choose a JPEG, PNG, or WebP photo.');
        const requestId = request.headers.get('Idempotency-Key');
        if (!requestId || !/^[a-f0-9-]{36}$/i.test(requestId)) throw new ServiceError(400, 'INVALID_REQUEST', 'Please start a new generation.');
        const bytes = await readLimited(request, IMAGE_LIMIT + 4096);
        const input = await new Response(bytes, { headers: { 'Content-Type': request.headers.get('Content-Type')! } }).formData();
        const image = input.get('image');
        if (!image || typeof image === 'string' || !image.size || image.size > IMAGE_LIMIT || !['image/jpeg', 'image/png', 'image/webp'].includes(image.type)) throw new ServiceError(400, 'INVALID_IMAGE', 'Choose a JPEG, PNG, or WebP photo under 8 MB.');
        const start = new Uint8Array(await image.slice(0, 12).arrayBuffer());
        const isImage = image.type === 'image/jpeg' ? start[0] === 255 && start[1] === 216 && start[2] === 255
          : image.type === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => start[i] === v)
          : new TextDecoder().decode(start.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(start.slice(8, 12)) === 'WEBP';
        if (!isImage) throw new ServiceError(400, 'INVALID_IMAGE', 'This file is not a supported photo.');
        for (const [owner, entry] of attempts) if (entry.until <= now()) attempts.delete(owner);
        const attempt = attempts.get(user) || { count: 0, until: now() + 300000 };
        if (attempt.count >= 4) throw new ServiceError(429, 'RATE_LIMITED', 'Please wait a few minutes before generating another model.');
        attempts.set(user, { ...attempt, count: attempt.count + 1 });
        body = new FormData(); body.set('image', image, 'furniture-photo' + ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[image.type]));
        headers['Idempotency-Key'] = requestId;
      }
      // Only the configured provider is contacted. Provider-supplied URLs are never fetched.
      const response = await fetchImpl.call(globalThis, `${config.base}/jobs${id ? `/${encodeURIComponent(id)}` : ''}${match[2] || ''}`, {
        method: body ? 'POST' : 'GET', headers, body, redirect: 'manual', signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ServiceError(response.status === 429 ? 429 : 502, 'MODEL_SERVICE_ERROR', response.status === 429 ? 'The 3D service is busy. Please try again shortly.' : 'The 3D service could not complete this request. Please try again.');
      }
      if (match[2]) {
        const bytes = await readLimited(response, MODEL_LIMIT);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) throw new ServiceError(502, 'INVALID_MODEL', 'The 3D service did not return a usable model.');
        return new Response(bytes, { headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
      }
      const bytes = await readLimited(response, 16384);
      let raw: unknown; try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ServiceError(502, 'INVALID_JOB', 'The 3D service returned an unreadable response.'); }
      const job = parseProviderJob(raw);
      if (id && id !== job.id) throw new ServiceError(502, 'INVALID_JOB', 'The 3D service returned a different generation.');
      return json({ status: job.status, progress: job.progress, stage: job.stage,
        ticket: match[1] || await issueTicket(job.id, user, config.key, now()) }, body ? 202 : 200);
    } catch (error) {
      if (error instanceof ServiceError) return json({ error: { code: error.code, message: error.message } }, error.status);
      return json({ error: { code: 'MODEL_UNAVAILABLE', message: 'Could not reach the 3D service. Check your connection and try again.' } }, 502);
    }
  };
}
