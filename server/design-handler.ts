import { DesignError, parseDesignRequest } from '../src/lib/design';
import { createDesignService } from './design-service';
import type { ClaudeEnv } from './claude';

const json = (value: unknown, status = 200, headers = {}) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});
const MAX_BODY = 5_000_000;
async function body(request: Request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BODY) throw new DesignError('TOO_LARGE', 'Use fewer or smaller room photos.', 413);
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
  if (reader) while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new DesignError('TOO_LARGE', 'Use fewer or smaller room photos.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new DesignError('INVALID_REQUEST', 'Send a valid room design request.'); }
}
export function createDesignHandler({ design = createDesignService(), now = Date.now } = {}) {
  let running = 0;
  const visitors = new Map<string, { count: number; expires: number }>();
  return async (request: Request, env: ClaudeEnv = {}) => {
    // Sites dispatch owns these identity headers. Never accept identity from the request body or browser storage.
    const identity = request.headers.get('oai-authenticated-user-id')?.trim();
    const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
    const allowed = new Set((env.DESIGN_ALLOWED_EMAILS ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
    const configured = !!env.ANTHROPIC_API_KEY?.trim() && allowed.size > 0;
    const authorized = !!identity && !!email && allowed.has(email);
    if (request.method === 'GET') return json({ configured, shopping: !!env.SERPAPI_API_KEY, signedIn: !!identity, authorized });
    if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST to design a room.' } }, 405, { Allow: 'GET, POST' });
    let acquired = false;
    try {
      const origin = request.headers.get('Origin');
      if (origin && origin !== new URL(request.url).origin) throw new DesignError('ORIGIN_NOT_ALLOWED', 'Open Roomify to design a room.', 403);
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new DesignError('INVALID_REQUEST', 'Send the room brief as JSON.', 415);
      if (!configured) throw new DesignError('DESIGN_NOT_CONFIGURED', 'Room design is not connected yet. You can prepare your brief and photos now.', 503);
      if (!identity) throw new DesignError('DESIGN_SIGN_IN_REQUIRED', 'Sign in with ChatGPT to check access to room design.', 401);
      if (!authorized) throw new DesignError('DESIGN_ACCESS_DENIED', 'Room design is not enabled for this account.', 403);
      const input = parseDesignRequest(await body(request));
      if (running >= 2) throw new DesignError('DESIGN_BUSY', 'Two rooms are being designed. Please try again shortly.', 429);
      const timestamp = now();
      for (const [key, entry] of visitors) if (entry.expires <= timestamp) visitors.delete(key);
      const entry = visitors.get(identity) ?? { count: 0, expires: timestamp + 3600000 };
      if (entry.count >= 12) throw new DesignError('DESIGN_RATE_LIMITED', 'The room-design allowance has been reached. Please try again later.', 429);
      if (visitors.size >= 1000 && !visitors.has(identity)) throw new DesignError('DESIGN_BUSY', 'Room design is busy. Please try again shortly.', 429);
      visitors.set(identity, { ...entry, count: entry.count + 1 }); running++; acquired = true;
      return json(await design(input, env, request.signal));
    } catch (error) {
      const known = error instanceof DesignError;
      return json({ error: { code: known ? error.code : 'DESIGN_FAILED', message: known ? error.message : 'The design could not be completed. Your layout has not changed.' } }, known ? error.status : 500);
    } finally { if (acquired) running--; }
  };
}
