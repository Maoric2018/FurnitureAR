import { createSearcher, parseSearchRequest } from './amazon-search.js';
import { ApiError } from './partner/errors.js';

const json = (value, status = 200, headers = {}) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});

async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > 4096) throw new ApiError(413, 'INVALID_REQUEST', 'That search is too long.');
  const reader = request.body?.getReader(), chunks = [];
  let bytes = 0;
  if (reader) while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 4096) { await reader.cancel(); throw new ApiError(413, 'INVALID_REQUEST', 'That search is too long.'); }
    chunks.push(value);
  }
  try {
    const buffer = new Uint8Array(bytes);
    let position = 0;
    for (const chunk of chunks) { buffer.set(chunk, position); position += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
  } catch { throw new ApiError(400, 'INVALID_REQUEST', 'Send a valid Amazon search.'); }
}

// These bounds apply per Worker instance, as on the product import endpoint.
// Cached searches do not consume the per-user provider-lookup allowance.
export function createSearchHandler({ search, now = Date.now } = {}) {
  const cache = new Map(), inFlight = new Map(), attempts = new Map();
  let searcher, key;
  return async (request, env = {}) => {
    try {
      if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for Amazon searches.' } }, 405, { Allow: 'POST' });
      const origin = request.headers.get('Origin');
      if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Open Furniture AR to search Amazon.');
      const user = request.headers.get('oai-authenticated-user-id');
      if (!user?.trim()) throw new ApiError(401, 'SIGN_IN_REQUIRED', 'Sign in to search Amazon products. Your layouts stay on this device.');
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new ApiError(415, 'INVALID_REQUEST', 'Send a search as JSON.');
      const input = parseSearchRequest(await readBody(request));
      const identity = JSON.stringify([input.q, input.page]);
      const timestamp = now(), cached = cache.get(identity);
      if (cached && timestamp < cached.expires) return json({ ...cached.value, cached: true });
      if (cached) cache.delete(identity);
      const window = attempts.get(user);
      if (window && timestamp < window.until && window.count >= 8) throw new ApiError(429, 'RATE_LIMITED', 'Please wait a minute before searching again.', Math.max(1, Math.ceil((window.until - timestamp) / 1000)));
      if (attempts.size >= 1000) {
        for (const [id, entry] of attempts) if (entry.until <= timestamp) attempts.delete(id);
        if (attempts.size >= 1000 && !attempts.has(user)) attempts.delete(attempts.keys().next().value);
      }
      attempts.set(user, window && timestamp < window.until ? { ...window, count: window.count + 1 } : { count: 1, until: timestamp + 60000 });
      if (!search && (!searcher || key !== env.SERPAPI_API_KEY)) { key = env.SERPAPI_API_KEY; searcher = createSearcher(env); }
      if (!inFlight.has(identity)) {
        if (inFlight.size >= 4) throw new ApiError(503, 'LOOKUP_BUSY', 'A few searches are loading. Try again shortly.', 2);
        inFlight.set(identity, Promise.resolve().then(() => (search || searcher)(input)).then(value => {
          if (cache.size >= 100) cache.delete(cache.keys().next().value);
          cache.set(identity, { value, expires: now() + 3600000 });
          return value;
        }).finally(() => inFlight.delete(identity)));
      }
      return json({ ...await inFlight.get(identity), cached: false });
    } catch (error) {
      const known = error instanceof ApiError;
      return json({ error: { code: known ? error.code : 'SEARCH_FAILED', message: known ? error.message : 'We couldn’t search Amazon. Please try again.' } },
        known ? error.status : 500, known && error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
    }
  };
}
