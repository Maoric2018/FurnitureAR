import { DesignError } from '../src/lib/design';
import type { DesignPhoto } from '../src/lib/design';

export interface ClaudeEnv { ANTHROPIC_API_KEY?: string; CLAUDE_MODEL?: string; SERPAPI_API_KEY?: string; DESIGN_ALLOWED_EMAILS?: string }
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
export type ClaudeCall = (input: { system: string; prompt: string; schema: Record<string, unknown>; photos?: DesignPhoto[] }, env: ClaudeEnv, signal?: AbortSignal) => Promise<unknown>;

const MAX_RESPONSE_BYTES = 512 * 1024;
const incomplete = () => new DesignError('DESIGN_INCOMPLETE', 'Claude returned an incomplete design. Please try again.', 502);
async function readClaudeResponse(response: Response): Promise<unknown> {
  if (Number(response.headers.get('Content-Length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw incomplete();
  }
  const reader = response.body?.getReader();
  if (!reader) throw incomplete();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw incomplete(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw incomplete(); }
}

/** HTTP Messages API is supported in both Workers and Node; secrets never enter browser code. */
export function createClaudeClient(fetchImpl: typeof fetch = fetch): ClaudeCall {
  return async (input, env, signal) => {
    if (!env.ANTHROPIC_API_KEY?.trim()) throw new DesignError('DESIGN_NOT_CONFIGURED', 'Room design is not connected yet. You can prepare your brief and photos now.', 503);
    const model = env.CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
    if (!/^claude-opus-[a-z0-9-]+$/.test(model)) throw new DesignError('DESIGN_CONFIG_ERROR', 'Room design needs a valid Claude Opus model configuration.', 503);
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 90000);
    try {
      signal?.throwIfAborted();
      const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
        // Workers supports manual redirects, not redirect: 'error'. Never follow
        // a redirect carrying the API key; non-2xx responses are rejected below.
        method: 'POST', redirect: 'manual', signal: abort.signal,
        headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 8000, system: input.system,
          messages: [{ role: 'user', content: [
            ...(input.photos ?? []).flatMap((photo, i) => [
              { type: 'text', text: `Room photo ${i + 1}. No camera pose is available; use for appearance, not measured placement.` },
              { type: 'image', source: { type: 'base64', media_type: photo.mediaType, data: photo.data } },
            ]), { type: 'text', text: input.prompt },
          ] }], output_config: { format: { type: 'json_schema', schema: input.schema } },
        }),
      });
      if (!response.ok) {
        // Provider bodies may contain credentials, prompts, or account details. Never forward them.
        await response.body?.cancel();
        if ([401, 403, 404].includes(response.status)) throw new DesignError('DESIGN_AUTH_FAILED', 'Claude is not available with the current service configuration. Please contact the app owner.', 503);
        if (response.status === 429) throw new DesignError('DESIGN_RATE_LIMITED', 'Claude is busy or its allowance has been reached. Try again shortly.', 429);
        throw new DesignError('DESIGN_UNAVAILABLE', 'Claude could not finish the design. Please try again.', 502);
      }
      const data = await readClaudeResponse(response) as { stop_reason?: unknown; content?: unknown } | null;
      if (!data || data.stop_reason !== 'end_turn') throw new DesignError('DESIGN_INCOMPLETE', 'Claude did not finish a complete design. Try a shorter brief.', 502);
      if (!Array.isArray(data.content) || data.content.some(b => !b || typeof b !== 'object' || typeof b.type !== 'string'
        || (b.type === 'text' && typeof b.text !== 'string'))) throw incomplete();
      const result = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
      if (!result || result.length > 150000) throw incomplete();
      try { return JSON.parse(result); } catch { throw new DesignError('DESIGN_INCOMPLETE', 'Claude returned an unreadable design. Please try again.', 502); }
    } catch (error) {
      if (error instanceof DesignError) throw error;
      if (abort.signal.aborted || signal?.aborted) throw new DesignError('DESIGN_TIMEOUT', 'The design took too long or was cancelled. Your layout has not changed.', 504);
      throw new DesignError('DESIGN_UNAVAILABLE', 'Could not reach Claude. Please try again.', 502);
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); }
  };
}
