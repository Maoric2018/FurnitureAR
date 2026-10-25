import test from 'node:test';
import assert from 'node:assert/strict';
import { createImportHandler } from '../server/import-handler.js';
import { normalizeImport } from '../server/amazon-import.js';
import { validateGeneratedModel } from '../server/model-service.js';

const ASIN = 'B012345678';
const OTHER = 'B087654321';
const request = (url = `https://www.amazon.com/dp/${ASIN}`, generateModel?: boolean) => new Request('https://furniture.example/api/products/import', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://furniture.example' }, body: JSON.stringify({ url, ...(generateModel === undefined ? {} : { generateModel }) }),
});
const generateRequest = (url?: string) => request(url, true);
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

test('Browsing imports a listing without requesting 3D, including across handler restarts', async () => {
  const bucket = new MemoryBucket(); let lookups = 0, starts = 0, polls = 0;
  const make = () => createImportHandler({ lookup: async asin => { lookups++; return listing(asin); },
    generator: { version: 'v1', start: async () => { starts++; return ready(); }, poll: async () => { polls++; return ready(); } } });
  const first = await (await make()(request(), { MODEL_BUCKET: bucket })).json();
  assert.equal(first.model.status, 'not_requested'); assert.equal(first.product, null);
  assert.equal(bucket.record().status, 'not_requested');
  const again = await (await make()(request(undefined, false), { MODEL_BUCKET: bucket })).json();
  assert.equal(again.model.status, 'not_requested'); assert.equal(again.cached, true);
  assert.equal(lookups, 1); assert.equal(starts, 0); assert.equal(polls, 0);
  assert.ok([...bucket.entries.keys()].every(key => !key.endsWith('.glb')));
  const requested = await (await make()(generateRequest(), { MODEL_BUCKET: bucket })).json();
  assert.equal(requested.model.status, 'ready'); assert.equal(starts, 1); assert.equal(lookups, 1);
  const reused = await (await make()(request(), { MODEL_BUCKET: bucket })).json();
  assert.deepEqual(reused.product, requested.product); assert.equal(reused.model.source, 'cache'); assert.equal(starts, 1);
});

test('Generation opt-in must be a boolean and is rejected before any product or model work', async () => {
  let calls = 0;
  const handler = createImportHandler({ lookup: async asin => { calls++; return listing(asin); } });
  for (const generateModel of ['true', 1, null, {}, []]) {
    const response = await handler(new Request('https://furniture.example/api/products/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: ASIN, generateModel }),
    }));
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
});

test('A concurrent browse cannot swallow explicit generation or duplicate the product lookup', async () => {
  for (const generateFirst of [false, true]) {
    const bucket = new MemoryBucket(); let lookups = 0, starts = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const handler = createImportHandler({ lookup: async asin => { lookups++; await gate; return listing(asin); },
      generator: { version: 'v1', start: async () => { starts++; return { status: 'pending', jobId: 'accepted' }; } } });
    const responses = generateFirst
      ? [handler(generateRequest(), { MODEL_BUCKET: bucket }), handler(request(), { MODEL_BUCKET: bucket })]
      : [handler(request(), { MODEL_BUCKET: bucket }), handler(generateRequest(), { MODEL_BUCKET: bucket })];
    release();
    const values = await Promise.all(responses.map(async response => (await response).json()));
    assert.equal(values[generateFirst ? 0 : 1].model.status, 'pending');
    assert.equal(bucket.record().jobId, 'accepted'); assert.equal(starts, 1); assert.equal(lookups, 1);
  }
});

test('Browsing a pending product neither polls nor waits for a slow status provider', async () => {
  const bucket = new MemoryBucket(); let clock = 1000, polls = 0;
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const handler = createImportHandler({ lookup: async asin => listing(asin), now: () => clock, generator: {
    version: 'v1', start: async () => ({ status: 'pending', jobId: 'accepted' }),
    poll: async () => { polls++; entered(); await gate; return ready(); },
  } });
  await handler(generateRequest(), { MODEL_BUCKET: bucket }); clock += 3001;
  assert.equal((await (await handler(request(), { MODEL_BUCKET: bucket })).json()).model.status, 'pending');
  assert.equal(polls, 0);
  const status = handler.models(statusRequest(), { MODEL_BUCKET: bucket }); await started;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const browsing = await Promise.race([
      handler(request(), { MODEL_BUCKET: bucket }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Browsing waited for generation')), 200); }),
    ]);
    assert.equal((await browsing.json()).model.status, 'pending'); assert.equal(polls, 1);
  } finally { if (timeout) clearTimeout(timeout); release(); }
  assert.equal((await (await status).json()).model.status, 'ready');
});

test('Status GET never starts generation for unrequested or terminal records, even after expiry or adapter upgrades', async () => {
  for (const state of ['not_requested', 'failed', 'not_configured', 'no_image']) {
    const bucket = new MemoryBucket();
    await createImportHandler({ lookup: async asin => listing(asin), now: () => 1000 })(request(), { MODEL_BUCKET: bucket });
    await bucket.put(`generated-models/amazon-com/${ASIN}/metadata.json`, JSON.stringify({ ...bucket.record(), status: state }));
    let starts = 0, polls = 0;
    const handler = createImportHandler({ lookup: async () => { throw new Error('Status must not look up the listing'); }, now: () => 4_000_000,
      generator: { version: 'new-version', start: async () => { starts++; return ready(); }, poll: async () => { polls++; return ready(); } } });
    const response = await handler.models(statusRequest(), { MODEL_BUCKET: bucket, MODEL_API_URL: 'https://sam.example', MODEL_API_KEY: 'configured' });
    assert.equal(response.status, 200); assert.equal((await response.json()).model.status, state);
    assert.equal(starts, 0); assert.equal(polls, 0);
  }
});

test('An expired intent without a job becomes retryable without GET submitting GPU work', async () => {
  const bucket = new MemoryBucket(); let starts = 0;
  const handler = createImportHandler({ lookup: async asin => listing(asin), now: () => 1000,
    generator: { version: 'v1', start: async () => { starts++; return { status: 'pending', jobId: 'recovered' }; } } });
  await handler(request(), { MODEL_BUCKET: bucket });
  await bucket.put(`generated-models/amazon-com/${ASIN}/metadata.json`, JSON.stringify({ ...bucket.record(), status: 'pending', nextPollAt: 999 }));
  assert.equal((await (await handler.models(statusRequest(), { MODEL_BUCKET: bucket })).json()).model.status, 'failed');
  assert.equal(starts, 0);
  assert.equal((await (await handler(generateRequest(), { MODEL_BUCKET: bucket })).json()).model.status, 'pending');
  assert.equal(starts, 1);
});

test('An adapter upgrade polls the accepted job with its original identity instead of creating another model', async () => {
  const bucket = new MemoryBucket(); let starts = 0;
  const first = createImportHandler({ lookup: async asin => listing(asin), now: () => 1000, generator: {
    version: 'v1', start: async () => { starts++; return { status: 'pending', jobId: 'original-job' }; },
  } });
  await first(generateRequest(), { MODEL_BUCKET: bucket });
  const upgraded = createImportHandler({ lookup: async () => { throw new Error('Reuse the accepted job listing'); }, now: () => 5000, generator: {
    version: 'v2', start: async () => { throw new Error('Do not replace an accepted job'); },
    poll: async input => {
      assert.equal(input.jobId, 'original-job');
      assert.equal(input.idempotencyKey, `furniture-ar:amazon-com:${ASIN}:v1`);
      return ready();
    },
  } });
  assert.equal((await (await upgraded.models(statusRequest(), { MODEL_BUCKET: bucket })).json()).model.status, 'ready');
  assert.equal(starts, 1);
});

test('An explicit retry after a confirmed provider failure creates one new persisted attempt', async () => {
  const bucket = new MemoryBucket(); let clock = 1000, lookups = 0;
  const keys: string[] = [];
  const generator = { version: 'v1', start: async input => {
    keys.push(input.idempotencyKey);
    return { status: 'pending', jobId: keys.length === 1 ? 'failed-job' : 'retry-job' };
  }, poll: async input => input.jobId === 'failed-job'
    ? { status: 'failed', failureConfirmed: true, jobId: input.jobId } : ready() };
  const make = () => createImportHandler({ lookup: async asin => { lookups++; return listing(asin); }, generator, now: () => clock });
  const handler = make();
  await handler(generateRequest(), { MODEL_BUCKET: bucket }); clock += 3001;
  const failed = await (await handler.models(statusRequest(), { MODEL_BUCKET: bucket })).json();
  assert.equal(failed.model.status, 'failed'); assert.equal(bucket.record().failureConfirmed, true);
  const originalKey = bucket.record().idempotencyKey;
  // Browsing or GET must preserve the failure/attempt even after metadata expires.
  clock += 3_600_001;
  assert.equal((await (await make()(request(), { MODEL_BUCKET: bucket })).json()).model.status, 'failed');
  assert.equal((await (await make().models(statusRequest(), { MODEL_BUCKET: bucket })).json()).model.status, 'failed');
  assert.equal(keys.length, 1); assert.equal(bucket.record().idempotencyKey, originalKey);
  const retries = await Promise.all([make()(generateRequest(), { MODEL_BUCKET: bucket }), make()(generateRequest(), { MODEL_BUCKET: bucket })]);
  assert.ok((await Promise.all(retries.map(response => response.json()))).every(value => value.model.status === 'pending'));
  assert.equal(keys.length, 2); assert.notEqual(keys[1], originalKey);
  assert.match(bucket.record().attemptId, /^[a-f0-9-]{36}$/);
  assert.equal(bucket.record().idempotencyKey, keys[1]);
  // A restarted service recovers that attempt, and its completion remains cached.
  clock += 3001;
  assert.equal((await (await make().models(statusRequest(), { MODEL_BUCKET: bucket })).json()).model.status, 'ready');
  assert.equal((await (await make()(request(), { MODEL_BUCKET: bucket })).json()).model.status, 'ready');
  assert.equal(keys.length, 2); assert.ok(lookups >= 1);
});

test('An ambiguous lost start response retains its key through browsing and explicit retry', async () => {
  const bucket = new MemoryBucket(); let clock = 1000, submissions = 0;
  const accepted = new Map<string, string>(); const keys: string[] = [];
  const make = (version = 'v1') => createImportHandler({ lookup: async asin => listing(asin), now: () => clock, generator: {
    version, start: async input => {
      keys.push(input.idempotencyKey);
      if (!accepted.has(input.idempotencyKey)) accepted.set(input.idempotencyKey, `job-${++submissions}`);
      if (keys.length === 1) throw new Error('Response lost after provider accepted the job');
      return { status: 'pending', jobId: accepted.get(input.idempotencyKey) };
    }, poll: async () => ready(),
  } });
  assert.equal((await (await make()(generateRequest(), { MODEL_BUCKET: bucket })).json()).model.status, 'failed');
  assert.equal(bucket.record().failureConfirmed, false);
  clock += 3_600_001;
  await make()(request(), { MODEL_BUCKET: bucket }); await make().models(statusRequest(), { MODEL_BUCKET: bucket });
  assert.equal(keys.length, 1); assert.equal(bucket.record().idempotencyKey, keys[0]);
  assert.equal((await (await make('v2')(generateRequest(), { MODEL_BUCKET: bucket })).json()).model.status, 'pending');
  assert.equal(keys[0], keys[1]); assert.equal(submissions, 1);
  clock += 3001;
  assert.equal((await (await make('v2').models(statusRequest(), { MODEL_BUCKET: bucket })).json()).model.status, 'ready');
  assert.equal(submissions, 1);
});

test('The concurrent lookup bound remains four distinct products across request modes', async () => {
  const bucket = new MemoryBucket(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const handler = createImportHandler({ lookup: async asin => { await gate; return listing(asin); }, generator: {
    version: 'v1', start: async () => ({ status: 'pending', jobId: 'accepted' }),
  } });
  const active = [ASIN, OTHER, 'B000000001', 'B000000002'].map(asin => handler(request(asin), { MODEL_BUCKET: bucket }));
  const sameProduct = handler(generateRequest(ASIN), { MODEL_BUCKET: bucket });
  try {
    const rejected = await handler(request('B000000003'), { MODEL_BUCKET: bucket });
    assert.equal(rejected.status, 503); assert.equal(rejected.headers.get('Retry-After'), '2');
  } finally { release(); }
  assert.ok((await Promise.all(active)).every(response => response.status === 200));
  assert.equal((await (await sameProduct).json()).model.status, 'pending');
});

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
  const response = await handler(generateRequest(`https://www.amazon.com/Test/dp/${ASIN}?tag=tracking&ref=anything`), { MODEL_BUCKET: bucket });
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
  const second = await (await anotherInstance(generateRequest(ASIN), { MODEL_BUCKET: bucket })).json();
  assert.equal(second.cached, true); assert.equal(second.model.source, 'cache'); assert.deepEqual(second.product, first.product);
  assert.equal(lookups, 1); assert.equal(starts, 1);
});

test('Two exact ASINs never share generated files or generation identities', async () => {
  const bucket = new MemoryBucket(); const ids: string[] = [];
  const handler = createImportHandler({ lookup: async asin => listing(asin), generator: { version: 'v1', start: async input => { ids.push(input.idempotencyKey); return ready(); } } });
  for (const asin of [ASIN, OTHER]) {
    const body = await (await handler(generateRequest(asin), { MODEL_BUCKET: bucket })).json();
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
  const responses = await Promise.all([handler(generateRequest(), { MODEL_BUCKET: bucket }), handler(generateRequest(), { MODEL_BUCKET: bucket })]);
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
  const first = await (await makeHandler()(generateRequest(), { MODEL_BUCKET: bucket })).json();
  assert.equal(first.model.status, 'not_configured'); assert.equal(first.product, null);
  const second = await (await makeHandler()(generateRequest(), { MODEL_BUCKET: bucket })).json();
  assert.equal(second.cached, true); assert.equal(calls, 1);
  assert.ok([...bucket.entries.keys()].every(key => !key.endsWith('.glb')));
  const upgraded = createImportHandler({ lookup: async () => { throw new Error('Reuse fresh listing'); }, generator: { version: 'real-v2', start: async () => ready() }, now: () => 2000 });
  assert.equal((await (await upgraded(generateRequest(), { MODEL_BUCKET: bucket })).json()).model.status, 'ready');
});

test('Unconfigured listing snapshot expires after an hour without becoming a permanent negative cache', async () => {
  const bucket = new MemoryBucket(); let calls = 0, clock = 1000;
  const handler = createImportHandler({ lookup: async asin => { calls++; return listing(asin); }, now: () => clock });
  await handler(generateRequest(), { MODEL_BUCKET: bucket });
  clock += 3600001;
  assert.equal((await (await handler(generateRequest(), { MODEL_BUCKET: bucket })).json()).model.status, 'not_configured');
  assert.equal(calls, 2);
});

test('Missing durable storage preserves listing imports and does not call generation; registered assets still work', async () => {
  let starts = 0;
  const handler = createImportHandler({ lookup: async asin => listing(asin), generator: { version: 'v1', start: async () => { starts++; return ready(); } } });
  const unknown = await (await handler(generateRequest())).json();
  assert.equal(unknown.listing.asin, ASIN); assert.equal(unknown.product, null); assert.equal(unknown.model.status, 'storage_unavailable'); assert.equal(starts, 0);
  const known = await (await handler(generateRequest('B0F2ML48Y6'))).json();
  assert.equal(known.model.status, 'ready'); assert.equal(known.model.source, 'registered'); assert.equal(starts, 0);
});

test('Failed intent, GLB, and ready-metadata writes never advertise a generated model as ready', async () => {
  for (const failure of ['intent', 'glb', 'ready']) {
    const bucket = new MemoryBucket(); let starts = 0;
    bucket.fail = (key, bytes) => failure === 'intent' || (failure === 'glb' && key.endsWith('.glb'))
      || (failure === 'ready' && key.endsWith('metadata.json') && JSON.parse(new TextDecoder().decode(bytes)).status === 'ready');
    const handler = createImportHandler({ lookup: async asin => listing(asin), generator: { version: 'v1', start: async () => { starts++; return ready(); } } });
    const body = await (await handler(generateRequest(), { MODEL_BUCKET: bucket })).json();
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
  const first = await (await handler(generateRequest(), { MODEL_BUCKET: bucket })).json();
  assert.equal(first.model.status, 'failed'); assert.equal(first.product, null); assert.notEqual(bucket.record().status, 'ready');
  assert.ok([...bucket.entries.keys()].every(key => !key.endsWith('.glb')));
  const second = await (await handler(generateRequest(), { MODEL_BUCKET: bucket })).json();
  assert.equal(second.model.status, 'ready'); assert.equal(calls, 2);
});

test('Only safe Amazon images reach generation; absent images are explicitly unavailable', async () => {
  const bucket = new MemoryBucket(); let starts = 0;
  const value = listing(); value.listing.images = ['https://unrelated.example/secret.jpg'];
  const handler = createImportHandler({ lookup: async () => value, generator: { version: 'v1', start: async () => { starts++; return ready(); } } });
  const body = await (await handler(generateRequest(), { MODEL_BUCKET: bucket })).json();
  assert.equal(body.model.status, 'no_image'); assert.equal(starts, 0); assert.equal(body.product, null);
});

test('Generated asset route serves bytes and HEAD with immutable headers and safe missing responses', async () => {
  const bucket = new MemoryBucket();
  const handler = createImportHandler({ lookup: async asin => listing(asin), generator: { version: 'v1', start: async () => ready() } });
  const imported = await (await handler(generateRequest(), { MODEL_BUCKET: bucket })).json();
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
  const firstResponse = first(generateRequest(), { MODEL_BUCKET: bucket }); await entered;
  clock += 18001; // The first instance's lease expires before its response arrives.
  const completed = await (await second(generateRequest(), { MODEL_BUCKET: bucket })).json();
  assert.equal(completed.model.status, 'ready');
  release({ status: 'pending', jobId: 'late-private-job' });
  assert.equal((await (await firstResponse).json()).model.status, 'ready');
  assert.equal(bucket.record().status, 'ready');
});

test('An unresponsive future adapter is aborted, returns safely, and remains retryable', async () => {
  const bucket = new MemoryBucket(); let signal: AbortSignal | undefined, calls = 0;
  const handler = createImportHandler({ lookup: async asin => listing(asin), adapterTimeoutMs: 10,
    generator: { version: 'v1', start: async input => { calls++; signal = input.signal; return calls === 1 ? new Promise(() => {}) : ready(); } } });
  const body = await (await handler(generateRequest(), { MODEL_BUCKET: bucket })).json();
  assert.equal(body.model.status, 'failed'); assert.equal(signal?.aborted, true);
  assert.equal((await (await handler(generateRequest(), { MODEL_BUCKET: bucket })).json()).model.status, 'ready');
});

test('Corrupt stored model metadata is repaired rather than reused as an invalid ready model', async () => {
  const bucket = new MemoryBucket(); let calls = 0;
  const handler = createImportHandler({ lookup: async asin => { calls++; return listing(asin); }, generator: { version: 'v1', start: async () => ready() } });
  await handler(generateRequest(), { MODEL_BUCKET: bucket });
  const record = bucket.record(); record.product.dimensions.height = -1;
  await bucket.put(`generated-models/amazon-com/${ASIN}/metadata.json`, JSON.stringify(record));
  const restarted = createImportHandler({ lookup: async asin => { calls++; return listing(asin); }, generator: { version: 'v1', start: async () => ready() } });
  const repaired = await (await restarted(generateRequest(), { MODEL_BUCKET: bucket })).json();
  assert.equal(repaired.model.status, 'ready'); assert.equal(repaired.product.dimensions.height, 1); assert.equal(calls, 2);
});
