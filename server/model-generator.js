import { configuration, parseProviderJob, readLimited } from './reconstruction-handler.ts';
import { normalizeSamGlb } from './sam3d-glb.js';

const OWNER = 'furniture-ar:amazon-com';
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_MODEL = 25 * 1024 * 1024;

function amazonImage(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || !/(^|\.)(media-amazon\.com|ssl-images-amazon\.com|images-amazon\.com)$/i.test(url.hostname)) throw new Error('Invalid product photo.');
  return url.href;
}
function imageType(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['image/jpeg', 'jpg'];
  if ([137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)) return ['image/png', 'png'];
  const text = new TextDecoder();
  if (text.decode(bytes.subarray(0,4)) === 'RIFF' && text.decode(bytes.subarray(8,12)) === 'WEBP') return ['image/webp', 'webp'];
  throw new Error('Unsupported product photo.');
}
// Convert the complete versioned identity to the Pod's UUID-shaped key. Retries
// from another Worker must reuse the same GPU job, not create a random UUID.
async function providerKey(value) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const hex = Array.from(hash.subarray(0,16), byte => byte.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

/** Async SAM 3D adapter for the exact-ASIN persistent model cache. */
export function createSam3dGenerator({ fetchImpl = fetch } = {}) {
  async function call(config, suffix, input, body) {
    input.signal?.throwIfAborted();
    const headers = { Authorization: `Bearer ${config.key}`, 'X-Furniture-User': OWNER };
    if (body) headers['Idempotency-Key'] = await providerKey(input.idempotencyKey);
    return fetchImpl.call(globalThis, `${config.base}/jobs${suffix}`, {
      method: body ? 'POST' : 'GET', headers, body, signal: input.signal, redirect: 'manual',
    });
  }
  async function result(response, config, input) {
    if (!response.ok) {
      await response.body?.cancel();
      // Keep an accepted job through a temporary outage.
      if (response.status === 429 || response.status >= 500) throw new Error('Model service temporarily unavailable.');
      return { status: 'failed' };
    }
    let job;
    try { job = parseProviderJob(JSON.parse(new TextDecoder().decode(await readLimited(response, 16384)))); }
    catch { return { status: 'failed' }; }
    if (input.jobId && job.id !== input.jobId) return { status: 'failed' };
    if (job.status === 'failed') return { status: 'failed' };
    if (job.status !== 'succeeded') return { status: 'pending', jobId: job.id, stage: job.stage };
    const model = await call(config, `/${encodeURIComponent(job.id)}/model`, input);
    if (!model.ok) { await model.body?.cancel(); throw new Error('Generated model unavailable.'); }
    let bytes;
    try { bytes = await readLimited(model, MAX_MODEL); }
    catch (error) { if (error?.code === 'TOO_LARGE') return { status: 'failed' }; throw error; }
    input.signal?.throwIfAborted();
    try { return { status: 'ready', ...normalizeSamGlb(bytes, input.listing?.dimensions) }; }
    catch { return { status: 'failed' }; }
  }
  return {
    version: 'sam3d-amazon-v1',
    async start(input, env = {}) {
      const config = configuration(env);
      if (!config) return { status: 'not_configured' };
      const photo = await fetchImpl.call(globalThis, amazonImage(input.imageUrl), { signal: input.signal, redirect: 'manual' });
      if (!photo.ok) { await photo.body?.cancel(); return { status: 'failed' }; }
      const bytes = await readLimited(photo, MAX_IMAGE);
      const [type, extension] = imageType(bytes);
      const body = new FormData(); body.set('image', new Blob([bytes], { type }), `product.${extension}`);
      return result(await call(config, '', input, body), config, input);
    },
    async poll(input, env = {}) {
      const config = configuration(env);
      if (!config) return { status: 'not_configured' };
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.jobId)) return { status: 'failed' };
      return result(await call(config, `/${encodeURIComponent(input.jobId)}`, input), config, input);
    },
  };
}
export const modelGenerator = createSam3dGenerator();
