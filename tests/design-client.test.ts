import test from 'node:test';
import assert from 'node:assert/strict';
import { designStatus, requestDesign } from '../src/lib/design-client.ts';
import type { DesignRequest } from '../src/lib/design.ts';

test('design status fails closed when access information is missing', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ configured: true, shopping: true }));
  await assert.rejects(designStatus(), /Could not check room design/);
});

test('design status uses same-origin sessions and exposes only readiness booleans', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, '/api/design/room');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    return Response.json({ configured: true, shopping: true, signedIn: false, authorized: true, extra: 'ignored' });
  });
  assert.deepEqual(await designStatus(), { configured: true, shopping: true, signedIn: false, authorized: true });
});

test('design errors show safe availability guidance without forwarding server details', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'DESIGN_UNAVAILABLE', message: 'private provider diagnostic' } }, { status: 502 }));
  await assert.rejects(requestDesign({} as DesignRequest, new AbortController().signal), error =>
    error instanceof Error && error.message.includes('temporarily unavailable') && !error.message.includes('private provider diagnostic'));
});
