import { createImporter, parseAmazonLink } from './amazon-import.js';
import { ApiError } from './partner/errors.js';

const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });

// Cache and coalesce repeated lookups so opening the same product does not
// repeatedly use the shared provider allowance. Limits are per worker instance.
export function createImportHandler({ lookup, now = Date.now } = {}) {
  const cache = new Map(), inFlight = new Map(), attempts = new Map();
  let importer, key;
  return async (request, env = {}) => {
    try {
      if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for product imports.' } }, 405, { Allow: 'POST' });
      const origin = request.headers.get('Origin');
      if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Open Furniture AR to import a product.');
      const user = request.headers.get('oai-authenticated-user-id');
      if (!user) throw new ApiError(401, 'SIGN_IN_REQUIRED', 'Sign in to import Amazon products. Your layouts stay on this device.');
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new ApiError(415, 'INVALID_REQUEST', 'Send a product link as JSON.');
      if (Number(request.headers.get('Content-Length')) > 4096) throw new ApiError(413, 'INVALID_REQUEST', 'That link is too long.');
      let bytes = 0, chunks = [], reader = request.body?.getReader();
      if (reader) while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 4096) { await reader.cancel(); throw new ApiError(413, 'INVALID_REQUEST', 'That link is too long.'); } chunks.push(value); }
      let body;
      try { const buffer = new Uint8Array(bytes); let at = 0; for (const chunk of chunks) { buffer.set(chunk, at); at += chunk.length; } body = JSON.parse(new TextDecoder().decode(buffer)); }
      catch { throw new ApiError(400, 'INVALID_REQUEST', 'Send a valid product link.'); }
      const asin = parseAmazonLink(body?.url);
      const cached = cache.get(asin);
      if (cached && now() < cached.expires) return json({ ...cached.value, cached: true });
      const window = attempts.get(user);
      if (window && now() < window.until && window.count >= 8) throw new ApiError(429, 'RATE_LIMITED', 'Please wait a minute before importing more products.', 60);
      if (attempts.size > 1000) for (const [id, entry] of attempts) if (entry.until < now()) attempts.delete(id);
      attempts.set(user, window && now() < window.until ? { ...window, count: window.count + 1 } : { count: 1, until: now() + 60000 });
      if (!lookup && (!importer || key !== env.SERPAPI_API_KEY)) { key = env.SERPAPI_API_KEY; importer = createImporter(env); }
      if (!inFlight.has(asin)) {
        if (inFlight.size >= 4) throw new ApiError(503, 'LOOKUP_BUSY', 'A few products are loading. Try again shortly.', 2);
        inFlight.set(asin, (lookup || importer)(asin).then(value => {
          if (cache.size >= 100) cache.delete(cache.keys().next().value);
          cache.set(asin, { value, expires: now() + 3600000 }); return value;
        }).finally(() => inFlight.delete(asin)));
      }
      return json({ ...await inFlight.get(asin), cached: false });
    } catch (error) {
      const known = error instanceof ApiError;
      return json({ error: { code: known ? error.code : 'IMPORT_FAILED', message: known ? error.message : 'We couldn’t import this product. Please try again.' } }, known ? error.status : 500, known && error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
    }
  };
}
