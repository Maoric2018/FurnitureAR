import test from 'node:test';
import assert from 'node:assert/strict';
import { createImportHandler } from '../server/import-handler.js';
import { normalizeImport } from '../server/amazon-import.js';
import { validateGeneratedModel } from '../server/model-service.js';

const ASIN = 'B012345678';
const OTHER = 'B087654321';
const request = (url = `https://www.amazon.com/dp/${ASIN}`) => new Request('https://furniture.example/api/products/import', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://furniture.example' }, body: JSON.stringify({ url }),
});
const statusRequest = (asin = ASIN) => new Request(`https://furniture.example/api/products/models/${asin}`);
const listing = (asin = ASIN, images = ['https://m.media-amazon.com/images/product.jpg']) => normalizeImport({
  product_results: { asin, title: 'Test chair', thumbnails: images },
}, asin);

function glb(overrides: Record<string, unknown> = {}) {
  const document = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }], ...overrides,
  };
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + jsonLength + 8 + 36);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonLength); bytes.set(json, 20);
  view.setUint32(20 + jsonLength, 36, true); view.setUint32(24 + jsonLength, 0x004e4942, true);
  return bytes;
}
const ready = () => ({ status: 'ready', glb: glb(), dimensions: { width: 1, height: 1, depth: 1 }, category: 'Seating' });

class MemoryBucket {
  entries = new Map<string, Uint8Array>();
  etags = new Map<string, string>();
  writes: string[] = [];
  fail: (key: string, bytes: Uint8Array) => boolean = () => false;
  async put(key: string, value: string | Uint8Array, options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) {
    if ((options?.onlyIf?.etagMatches && this.etags.get(key) !== options.onlyIf.etagMatches)
        || (options?.onlyIf?.etagDoesNotMatch === '*' && this.entries.has(key))) return null;
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value.slice();
    if (this.fail(key, bytes)) throw new Error('storage failed with private credentials');
    this.entries.set(key, bytes); this.writes.push(key);
    const etag = `version-${this.writes.length}`; this.etags.set(key, etag);
    return { etag };
  }
  async get(key: string) {
    const bytes = this.entries.get(key);
    return bytes ? { size: bytes.length, etag: this.etags.get(key), body: bytes.slice(), text: async () => new TextDecoder().decode(bytes) } : null;
  }
  async head(key: string) { const bytes = this.entries.get(key); return bytes ? { size: bytes.length } : null; }
  record(asin = ASIN) { return JSON.parse(new TextDecoder().decode(this.entries.get(`generated-models/amazon-com/${asin}/metadata.json`))); }
}

test('Generated GLB and canonical metadata survive new handler instances and skip both providers indefinitely', async () => {
  const bucket = new MemoryBucket(); let lookups = 0, starts = 0;
  const handler = createImportHandler({ lookup: async asin => { lookups++; return listing(asin); }, generator: {
    version: 'test-v1', start: async input => {
      starts++; assert.equal(input.asin, ASIN); assert.equal(input.url, `https://www.amazon.com/dp/${ASIN}`);
      assert.equal(input.imageUrl, 'https://m.media-amazon.com/images/product.jpg');
      assert.equal(input.idempotencyKey, `furniture-ar:amazon-com:${ASIN}:test-v1`);
      return ready();
    },
  } });
  const response = await handler(request(`https://www.amazon.com/Test/dp/${ASIN}?tag=tracking&ref=anything`), { MODEL_BUCKET: bucket });
  assert.equal(response.status, 200);
  const first = await response.json(); assert.equal(first.cached, false); assert.equal(first.model.status, 'ready'); assert.equal(first.model.source, 'generated');
  assert.equal(first.product.variants.length, 1); assert.equal(first.product.variants[0].asin, ASIN);
  assert.equal(first.product.variants[0].productUrl, `https://www.amazon.com/dp/${ASIN}`);
  assert.match(first.product.variants[0].modelSrc, new RegExp(`^/api/products/models/${ASIN}/[a-f0-9]{64}\\.glb$`));
  const record = bucket.record(); assert.equal(record.url, `https://www.amazon.com/dp/${ASIN}`);
  assert.equal(record.listing.asin, ASIN); assert.equal(record.status, 'ready'); assert.equal(record.generatorVersion, 'test-v1');
  assert.match(bucket.writes.at(-2)!, /\.glb$/); assert.match(bucket.writes.at(-1)!, /metadata\.json$/);
  const anotherInstance = createImportHandler({ lookup: async () => { throw new Error('Must not call SerpApi'); },
    generator: { version: 'new-generator', start: async () => { throw new Error('Must not regenerate'); } }, now: () => Date.now() + 10 * 365 * 86400000 });
  const second = await (await anotherInstance(request(ASIN), { MODEL_BUCKET: bucket })).json();
  assert.equal(second.cached, true); assert.equal(second.model.source, 'cache'); assert.deepEqual(second.product, first.product);
  assert.equal(lookups, 1); assert.equal(starts, 1);
});

test('Two exact ASINs never share generated files or generation identities', async () => {
  const bucket = new MemoryBucket(); const ids: string[] = [];
  const handler = createImportHandler({ lookup: async asin => listing(asin), generator: { version: 'v1', start: async input => { ids.push(input.idempotencyKey); return ready(); } } });
  for (const asin of [ASIN, OTHER]) {
    const body = await (await handler(request(asin), { MODEL_BUCKET: bucket })).json();
    assert.equal(body.product.variants[0].asin, asin); assert.ok(body.product.variants[0].modelSrc.includes(asin));
  }
  assert.equal(new Set(ids).size, 2); assert.ok(bucket.record(ASIN)); assert.ok(bucket.record(OTHER));
});

test('Concurrent imports coalesce and persisted pending jobs poll to ready after an instance restart', async () => {
  const bucket = new MemoryBucket(); let starts = 0, polls = 0, lookups = 0, clock = 1000;
  const generator = { version: 'v1', start: async () => { starts++; return { status: 'pending', jobId: 'PRIVATE_PROVIDER_JOB' }; },
    poll: async input => { polls++; assert.equal(input.jobId, 'PRIVATE_PROVIDER_JOB'); assert.equal(input.idempotencyKey, `furniture-ar:amazon-com:${ASIN}:v1`); return ready(); } };
  const makeHandler = () => createImportHandler({ lookup: async asin => { lookups++; return listing(asin); }, generator, now: () => clock });
  const handler = makeHandler();
  const responses = await Promise.all([handler(request(), { MODEL_BUCKET: bucket }), handler(request(), { MODEL_BUCKET: bucket })]);
  for (const response of responses) { const text = await response.text(); assert.match(text, /pending/); assert.ok(!text.includes('PRIVATE_PROVIDER_JOB')); }
  assert.equal(starts, 1); assert.equal(lookups, 1); assert.equal(bucket.record().jobId, 'PRIVATE_PROVIDER_JOB');
  const restarted = makeHandler();
  assert.equal((await (await restarted.models(statusRequest(), { MODEL_BUCKET: bucket })).json()).model.status, 'pending');
  assert.equal(polls, 0);
  clock += 3001;
  const completed = await Promise.all([restarted.models(statusRequest(), { MODEL_BUCKET: bucket }), restarted.models(statusRequest(), { MODEL_BUCKET: bucket })]);
  assert.equal((await completed[0].json()).model.status, 'ready'); assert.equal((await completed[1].json()).model.status, 'ready');
  assert.equal(polls, 1); assert.equal(starts, 1); assert.equal(lookups, 1);
});

test('Default dummy saves no fake model and fresh negative metadata is reused across instances', async () => {
  const bucket = new MemoryBucket(); let calls = 0;
  const makeHandler = () => createImportHandler({ lookup: async asin => { calls++; return listing(asin); }, now: () => 1000 });
  const first = await (await makeHandler()(request(), { MODEL_BUCKET: bucket })).json();
  assert.equal(first.model.status, 'not_configured'); assert.equal(first.product, null);
  const second = await (await makeHandler()(request(), { MODEL_BUCKET: bucket })).json();
  assert.equal(second.cached, true); assert.equal(calls, 1);
  assert.ok([...bucket.entries.keys()].every(key => !key.endsWith('.glb')));
  const upgraded = createImportHandler({ lookup: async () => { throw new Error('Reuse fresh listing'); }, generator: { version: 'real-v2', start: async () => ready() }, now: () => 2000 });
  assert.equal((await (await upgraded(request(), { MODEL_BUCKET: bucket })).json()).model.status, 'ready');
});

test('Unconfigured listing snapshot expires after an hour without becoming a permanent negative cache', async () => {
  const bucket = new MemoryBucket(); let calls = 0, clock = 1000;
  const handler = createImportHandler({ lookup: async asin => { calls++; return listing(asin); }, now: () => clock });
  await handler(request(), { MODEL_BUCKET: bucket });
  clock += 3600001;
  assert.equal((await (await handler(request(), { MODEL_BUCKET: bucket })).json()).model.status, 'not_configured');
  assert.equal(calls, 2);
});

test('Missing durable storage preserves listing imports and does not call generation; registered assets still work', async () => {
  let starts = 0;
  const handler = createImportHandler({ lookup: async asin => listing(asin), generator: { version: 'v1', start: async () => { starts++; return ready(); } } });
  const unknown = await (await handler(request())).json();
  assert.equal(unknown.listing.asin, ASIN); assert.equal(unknown.product, null); assert.equal(unknown.model.status, 'storage_unavailable'); assert.equal(starts, 0);
  const known = await (await handler(request('B0F2ML48Y6'))).json();
  assert.equal(known.model.status, 'ready'); assert.equal(known.model.source, 'registered'); assert.equal(starts, 0);
});

test('Failed intent, GLB, and ready-metadata writes never advertise a generated model as ready', async () => {
  for (const failure of ['intent', 'glb', 'ready']) {
    const bucket = new MemoryBucket(); let starts = 0;
    bucket.fail = (key, bytes) => failure === 'intent' || (failure === 'glb' && key.endsWith('.glb'))
      || (failure === 'ready' && key.endsWith('metadata.json') && JSON.parse(new TextDecoder().decode(bytes)).status === 'ready');
    const handler = createImportHandler({ lookup: async asin => listing(asin), generator: { version: 'v1', start: async () => { starts++; return ready(); } } });
    const body = await (await handler(request(), { MODEL_BUCKET: bucket })).json();
    assert.equal(body.model.status, 'storage_unavailable'); assert.equal(body.product, null);
    assert.equal(starts, failure === 'intent' ? 0 : 1);
    if (failure !== 'intent') assert.notEqual(bucket.record().status, 'ready');
    assert.ok(!JSON.stringify(body).includes('private credentials'));
  }
});

test('GLB validation rejects malformed containers, external resources, excessive size and invalid dimensions', () => {
  assert.equal(validateGeneratedModel(ready()).byteLength, ready().glb.byteLength);
  const malformed = ready(); malformed.glb[0] = 0; assert.throws(() => validateGeneratedModel(malformed));
  assert.throws(() => validateGeneratedModel({ ...ready(), glb: glb({ buffers: [{ byteLength: 36, uri: 'https://example.com/mesh.bin' }] }) }));
  assert.throws(() => validateGeneratedModel({ ...ready(), glb: glb({ images: [{ uri: 'https://example.com/texture.jpg' }] }) }));
  assert.throws(() => validateGeneratedModel({ ...ready(), glb: glb({ buffers: [{ byteLength: 100 }] }) }));
  assert.throws(() => validateGeneratedModel({ ...ready(), glb: new Uint8Array(25 * 1024 * 1024 + 1) }));
  for (const height of [0, -1, Infinity, NaN, 21]) assert.throws(() => validateGeneratedModel({ ...ready(), dimensions: { width: 1, height, depth: 1 } }));
});

test('Malformed generated models stay retryable and never write GLB bytes or ready metadata', async () => {
  const bucket = new MemoryBucket(); let calls = 0;
  const handler = createImportHandler({ lookup: async asin => listing(asin), generator: { version: 'v1', start: async () => {
    calls++; return calls === 1 ? { ...ready(), glb: new Uint8Array([1, 2, 3]) } : ready();
  } } });
  const first = await (await handler(request(), { MODEL_BUCKET: bucket })).json();
  assert.equal(first.model.status, 'failed'); assert.equal(first.product, null); assert.notEqual(bucket.record().status, 'ready');
  assert.ok([...bucket.entries.keys()].every(key => !key.endsWith('.glb')));
  const second = await (await handler(request(), { MODEL_BUCKET: bucket })).json();
  assert.equal(second.model.status, 'ready'); assert.equal(calls, 2);
});

test('Only safe Amazon images reach generation; absent images are explicitly unavailable', async () => {
  const bucket = new MemoryBucket(); let starts = 0;
  const value = listing(); value.listing.images = ['https://unrelated.example/secret.jpg'];
  const handler = createImportHandler({ lookup: async () => value, generator: { version: 'v1', start: async () => { starts++; return ready(); } } });
  const body = await (await handler(request(), { MODEL_BUCKET: bucket })).json();
  assert.equal(body.model.status, 'no_image'); assert.equal(starts, 0); assert.equal(body.product, null);
});

test('Generated asset route serves bytes and HEAD with immutable headers and safe missing responses', async () => {
  const bucket = new MemoryBucket();
  const handler = createImportHandler({ lookup: async asin => listing(asin), generator: { version: 'v1', start: async () => ready() } });
  const imported = await (await handler(request(), { MODEL_BUCKET: bucket })).json();
  const url = `https://furniture.example${imported.product.variants[0].modelSrc}`;
  const asset = await handler.models(new Request(url), { MODEL_BUCKET: bucket });
  assert.equal(asset.status, 200); assert.equal(asset.headers.get('Content-Type'), 'model/gltf-binary');
  assert.equal(asset.headers.get('X-Content-Type-Options'), 'nosniff'); assert.match(asset.headers.get('Cache-Control')!, /immutable/);
  assert.deepEqual(new Uint8Array(await asset.arrayBuffer()), ready().glb);
  const head = await handler.models(new Request(url, { method: 'HEAD' }), { MODEL_BUCKET: bucket });
  assert.equal(head.status, 200); assert.equal(await head.text(), ''); assert.equal(head.headers.get('Content-Length'), String(ready().glb.length));
  assert.equal((await handler.models(new Request(url.replace(ASIN, OTHER)), { MODEL_BUCKET: bucket })).status, 404);
  assert.equal((await handler.models(new Request(url, { method: 'POST' }), { MODEL_BUCKET: bucket })).status, 405);
  assert.equal((await handler.models(new Request('https://furniture.example/api/products/models/invalid'), { MODEL_BUCKET: bucket })).status, 404);
});

test('Status checks do not create product lookups and honor same-origin requests', async () => {
  let calls = 0;
  const handler = createImportHandler({ lookup: async asin => { calls++; return listing(asin); } });
  const bucket = new MemoryBucket();
  assert.equal((await handler.models(statusRequest(), { MODEL_BUCKET: bucket })).status, 404);
  assert.equal((await handler.models(statusRequest())).status, 503);
  const crossOrigin = statusRequest(); crossOrigin.headers.set('Origin', 'https://other.example');
  assert.equal((await handler.models(crossOrigin, { MODEL_BUCKET: bucket })).status, 403);
  assert.equal(calls, 0);
});

test('A late pending response from another Worker cannot overwrite a durable ready model', async () => {
  const bucket = new MemoryBucket(); let clock = 1000;
  let started!: () => void, release!: (value: unknown) => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const late = new Promise(resolve => { release = resolve; });
  const first = createImportHandler({ lookup: async asin => listing(asin), now: () => clock,
    generator: { version: 'v1', start: async () => { started(); return late; } } });
  const second = createImportHandler({ lookup: async () => { throw new Error('Reuse persisted listing'); }, now: () => clock,
    generator: { version: 'v1', start: async () => ready() } });
  const firstResponse = first(request(), { MODEL_BUCKET: bucket }); await entered;
  clock += 18001; // The first instance's lease expires before its response arrives.
  const completed = await (await second(request(), { MODEL_BUCKET: bucket })).json();
  assert.equal(completed.model.status, 'ready');
  release({ status: 'pending', jobId: 'late-private-job' });
  assert.equal((await (await firstResponse).json()).model.status, 'ready');
  assert.equal(bucket.record().status, 'ready');
});

test('An unresponsive future adapter is aborted, returns safely, and remains retryable', async () => {
  const bucket = new MemoryBucket(); let signal: AbortSignal | undefined, calls = 0;
  const handler = createImportHandler({ lookup: async asin => listing(asin), adapterTimeoutMs: 10,
    generator: { version: 'v1', start: async input => { calls++; signal = input.signal; return calls === 1 ? new Promise(() => {}) : ready(); } } });
  const body = await (await handler(request(), { MODEL_BUCKET: bucket })).json();
  assert.equal(body.model.status, 'failed'); assert.equal(signal?.aborted, true);
  assert.equal((await (await handler(request(), { MODEL_BUCKET: bucket })).json()).model.status, 'ready');
});

test('Corrupt stored model metadata is repaired rather than reused as an invalid ready model', async () => {
  const bucket = new MemoryBucket(); let calls = 0;
  const handler = createImportHandler({ lookup: async asin => { calls++; return listing(asin); }, generator: { version: 'v1', start: async () => ready() } });
  await handler(request(), { MODEL_BUCKET: bucket });
  const record = bucket.record(); record.product.dimensions.height = -1;
  await bucket.put(`generated-models/amazon-com/${ASIN}/metadata.json`, JSON.stringify(record));
  const restarted = createImportHandler({ lookup: async asin => { calls++; return listing(asin); }, generator: { version: 'v1', start: async () => ready() } });
  const repaired = await (await restarted(request(), { MODEL_BUCKET: bucket })).json();
  assert.equal(repaired.model.status, 'ready'); assert.equal(repaired.product.dimensions.height, 1); assert.equal(calls, 2);
});
