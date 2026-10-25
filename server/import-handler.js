import { parseAmazonLink } from './amazon-import.js';
import { ApiError } from './partner/errors.js';
import { createModelService } from './model-service.js';

const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });

// Cache and coalesce repeated lookups so opening the same product does not
// repeatedly use the shared provider allowance. Limits are per worker instance.
export function createImportHandler(options = {}) {
  const service = createModelService(options);
  const failure = (error, fallbackCode = 'IMPORT_FAILED') => {
    const known = error instanceof ApiError;
    return json({ error: { code: known ? error.code : fallbackCode, message: known ? error.message : 'We couldn’t load this product. Please try again.' } }, known ? error.status : 500, known && error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
  };
  const handler = async (request, env = {}) => {
    try {
      if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for product imports.' } }, 405, { Allow: 'POST' });
      const origin = request.headers.get('Origin');
      if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Open Furniture AR to import a product.');
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new ApiError(415, 'INVALID_REQUEST', 'Send a product link as JSON.');
      if (Number(request.headers.get('Content-Length')) > 4096) throw new ApiError(413, 'INVALID_REQUEST', 'That link is too long.');
      let bytes = 0, chunks = [], reader = request.body?.getReader();
      if (reader) while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 4096) { await reader.cancel(); throw new ApiError(413, 'INVALID_REQUEST', 'That link is too long.'); } chunks.push(value); }
      let body;
      try { const buffer = new Uint8Array(bytes); let at = 0; for (const chunk of chunks) { buffer.set(chunk, at); at += chunk.length; } body = JSON.parse(new TextDecoder().decode(buffer)); }
      catch { throw new ApiError(400, 'INVALID_REQUEST', 'Send a valid product link.'); }
      const asin = parseAmazonLink(body?.url);
      if (body.generateModel !== undefined && typeof body.generateModel !== 'boolean') {
        throw new ApiError(400, 'INVALID_REQUEST', 'Choose whether to generate a 3D model.');
      }
      return json(await service.load(asin, env, body.generateModel === true ? 'generate' : 'lookup'));
    } catch (error) { return failure(error); }
  };
  handler.models = async (request, env = {}) => {
    const pathname = new URL(request.url).pathname;
    const asset = pathname.match(/^\/api\/products\/models\/([A-Z0-9]{10})\/([a-f0-9]{64})\.glb$/);
    if (asset) return service.asset(request, env, asset[1], asset[2]);
    const status = pathname.match(/^\/api\/products\/models\/([A-Z0-9]{10})$/);
    if (!status) return json({ error: { code: 'MODEL_NOT_FOUND', message: 'This saved model was not found.' } }, 404);
    try {
      if (request.method !== 'GET') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET to check a model.' } }, 405, { Allow: 'GET' });
      const origin = request.headers.get('Origin');
      if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Open Furniture AR to check a model.');
      return json(await service.load(status[1], env, 'status'));
    } catch (error) { return failure(error, 'MODEL_LOOKUP_FAILED'); }
  };
  return handler;
}
