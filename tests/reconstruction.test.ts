import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { createReconstructionHandler, parseProviderJob } from '../server/reconstruction-handler.ts';
import { parseGenerationJob, validatePhoto } from '../src/lib/reconstruction.ts';
import { checkEmbeddedGlb, normalizeGeneratedScene } from '../src/lib/reconstruction-model.ts';

const env = { MODEL_API_URL: 'https://model.example/v1', MODEL_API_KEY: 'private-test-secret-never-for-the-browser' };
const requestId = 'c7ec7496-b862-46c8-8d86-26c875b93b50';
const origin = 'https://furniture.example';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YGJ1CsAAAAASUVORK5CYII=', 'base64');
function createRequest(user = 'alice', file: Blob = new Blob([image], { type: 'image/png' })) {
  const body = new FormData(); body.set('image', file, 'private-original-filename.png');
  return new Request(`${origin}/api/reconstruction/jobs`, { method: 'POST', headers: { Origin: origin, 'Idempotency-Key': requestId, ...(user ? { 'oai-authenticated-user-id': user } : {}) }, body });
}
const statusRequest = (ticket: string, user = 'alice', suffix = '') => new Request(`${origin}/api/reconstruction/jobs/${ticket}${suffix}`, { headers: { 'oai-authenticated-user-id': user } });

test('Configuration is public but secrets and provider URLs never leave the server; missing backend does not fabricate a job', async () => {
  let calls = 0;
  const handler = createReconstructionHandler({ fetchImpl: (async () => { calls++; throw new Error(); }) as typeof fetch });
  const config = await handler(new Request(`${origin}/api/reconstruction/config`), env);
  assert.deepEqual(await config.json(), { configured: true, signedIn: false });
  const missing = await handler(createRequest(), {});
  assert.equal(missing.status, 503); assert.equal((await missing.json()).error.code, 'MODEL_NOT_CONFIGURED'); assert.equal(calls, 0);
  const insecure = await handler(new Request(`${origin}/api/reconstruction/config`), { ...env, MODEL_API_URL: 'http://model.example' });
  assert.equal((await insecure.json()).configured, false);
});
test('Uploads require sign-in and same-origin requests before any provider call', async () => {
  let calls = 0;
  const handler = createReconstructionHandler({ fetchImpl: (async () => { calls++; return Response.json({}); }) as typeof fetch });
  assert.equal((await handler(createRequest(''), env)).status, 401);
  const cross = createRequest(); cross.headers.set('Origin', 'https://other.example');
  assert.equal((await handler(cross, env)).status, 403);
  assert.equal((await handler(new Request(`${origin}/api/reconstruction/jobs`, { method: 'GET' }), env)).status, 405);
  assert.equal(calls, 0);
});
test('Camera image reaches the configured service, using server credentials, stripped filename and idempotency; job/status/model complete the real contract', async () => {
  const lamp = await readFile(new URL('../public/models/ambimall-floor-lamp.glb', import.meta.url));
  const paths: string[] = [];
  const handler = createReconstructionHandler({ fetchImpl: (async function(this: unknown, url: string, init: RequestInit) {
    assert.equal(this, globalThis); assert.equal(init.redirect, 'manual');
    paths.push(url); assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${env.MODEL_API_KEY}`);
    if (init.method === 'POST') {
      assert.equal((init.headers as Record<string, string>)['Idempotency-Key'], requestId);
      const file = (init.body as FormData).get('image') as File;
      assert.equal(file.name, 'furniture-photo.png'); assert.deepEqual(Buffer.from(await file.arrayBuffer()), image);
      return Response.json({ id: 'job_1', status: 'queued', api_key: env.MODEL_API_KEY, model_url: 'https://untrusted.example' });
    }
    if (url.endsWith('/model')) return new Response(lamp, { headers: { 'Content-Type': 'model/gltf-binary' } });
    return Response.json({ id: 'job_1', status: 'succeeded', progress: 100 });
  }) as typeof fetch });
  const created = await handler(createRequest(), env); assert.equal(created.status, 202);
  const job = parseGenerationJob(await created.json()); assert.equal(job.status, 'queued');
  assert(!JSON.stringify(job).includes(env.MODEL_API_KEY)); assert(!JSON.stringify(job).includes('untrusted'));
  const completed = parseGenerationJob(await (await handler(statusRequest(job.ticket), env)).json());
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.progress, 100);
  const model = await handler(statusRequest(job.ticket, 'alice', '/model'), env);
  assert.equal(model.headers.get('Content-Type'), 'model/gltf-binary'); assert.deepEqual(Buffer.from(await model.arrayBuffer()), lamp);
  assert.deepEqual(paths, ['https://model.example/v1/jobs', 'https://model.example/v1/jobs/job_1', 'https://model.example/v1/jobs/job_1/model']);
});
test('Job tickets cannot be used by another user, tampered with, or used after expiry', async () => {
  let now = 1000, calls = 0;
  const handler = createReconstructionHandler({ now: () => now, fetchImpl: (async () => { calls++; return Response.json({ id: 'one', status: 'queued' }); }) as typeof fetch });
  const { ticket } = await (await handler(createRequest(), env)).json();
  assert.equal((await handler(statusRequest(ticket, 'bob'), env)).status, 404);
  assert.equal((await handler(statusRequest(ticket.replace(/^./, 'x')), env)).status, 404);
  now += 25 * 3600000; assert.equal((await handler(statusRequest(ticket), env)).status, 404); assert.equal(calls, 1);
});
test('Oversized bodies and fake image types are rejected before upload', async () => {
  let calls = 0;
  const handler = createReconstructionHandler({ fetchImpl: (async () => { calls++; return Response.json({}); }) as typeof fetch });
  const large = createRequest(); large.headers.set('Content-Length', String(9 * 1024 * 1024));
  assert.equal((await handler(large, env)).status, 413);
  assert.equal((await handler(createRequest('alice', new Blob(['not an image'], { type: 'image/png' })), env)).status, 400);
  assert.equal((await handler(createRequest('alice', new Blob(['svg'], { type: 'image/svg+xml' })), env)).status, 400);
  assert.equal(calls, 0);
});
test('Provider redirects, failures, and untrusted error bodies cannot leak credentials', async () => {
  for (const response of [new Response(env.MODEL_API_KEY, { status: 302, headers: { Location: 'https://other.example' } }), new Response(env.MODEL_API_KEY, { status: 500 })]) {
    const handler = createReconstructionHandler({ fetchImpl: (async () => response) as typeof fetch });
    const result = await handler(createRequest(), env); assert.equal(result.status, 502); assert(!(await result.text()).includes(env.MODEL_API_KEY));
  }
});
test('Wrong job identities, invalid percentages, and unusable model files fail visibly', async () => {
  for (const progress of [-1, 101, NaN, Infinity, '50']) assert.throws(() => parseProviderJob({ id: 'job', status: 'processing', progress }));
  assert.throws(() => parseProviderJob({ id: '../admin', status: 'queued' }));
  let count = 0;
  const handler = createReconstructionHandler({ fetchImpl: (async () => Response.json({ id: count++ ? 'different' : 'first', status: 'succeeded' })) as typeof fetch });
  const { ticket } = await (await handler(createRequest(), env)).json();
  assert.equal((await handler(statusRequest(ticket), env)).status, 502);
  assert.equal((await handler(statusRequest(ticket, 'alice', '/model'), env)).status, 502);
});
test('A failed reconstruction remains failed and has no fabricated result or progress', async () => {
  assert.deepEqual(parseProviderJob({ id: 'bad-photo', status: 'failed', message: 'internal details', model_url: 'anything' }), { id: 'bad-photo', status: 'failed' });
  const parsed = parseGenerationJob({ ticket: 'payload.signature', status: 'failed' }); assert.equal(parsed.progress, undefined);
  assert.throws(() => parseGenerationJob({ ticket: '../admin', status: 'succeeded' }));
  assert.throws(() => validatePhoto({ size: 200, type: 'image/heic' }));
  assert.throws(() => validatePhoto({ size: 21 * 1024 * 1024, type: 'image/jpeg' }));
});
test('Reconstructed geometry preserves proportions, uses measured height, centers X/Z and rests on the floor', () => {
  const source = new Group(), mesh = new Mesh(new BoxGeometry(2, 4, 3), new MeshStandardMaterial());
  mesh.position.set(4, 5, -3); source.add(mesh);
  const normalized = normalizeGeneratedScene(source, .8), bounds = new Box3().setFromObject(normalized.scene), size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
  assert(Math.abs(size.y - .8) < 1e-6); assert(Math.abs(size.x - .4) < 1e-6); assert(Math.abs(size.z - .6) < 1e-6);
  assert(Math.abs(center.x) < 1e-6); assert(Math.abs(center.z) < 1e-6); assert(Math.abs(bounds.min.y) < 1e-6);
  assert.throws(() => normalizeGeneratedScene(new Group(), 1)); assert.throws(() => normalizeGeneratedScene(source, 0));
  mesh.geometry.getAttribute('position').setX(0, NaN); assert.throws(() => normalizeGeneratedScene(source, 1), /invalid geometry/);
});
test('Generated GLBs must be self-contained and malformed assets cannot trigger external texture requests', async () => {
  const original = await readFile(new URL('../public/models/little-tree-oak-table.glb', import.meta.url));
  checkEmbeddedGlb(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength));
  function glb(data: object) { const json = Buffer.from(JSON.stringify(data)); const bytes = new ArrayBuffer(20 + json.length), view = new DataView(bytes); view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.byteLength, true); view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true); new Uint8Array(bytes, 20).set(json); return bytes; }
  assert.throws(() => checkEmbeddedGlb(glb({ asset: { version: '2.0' }, meshes: [{}], images: [{ uri: 'https://other.example/track' }] })), /include its textures/);
  assert.throws(() => checkEmbeddedGlb(new ArrayBuffer(12)));
});
