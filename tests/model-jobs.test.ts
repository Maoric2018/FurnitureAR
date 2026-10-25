import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ImportError, parseAmazonProductResult } from '../src/lib/amazon.ts';
import type { AmazonModel, AmazonProductResult } from '../src/lib/amazon.ts';
import { createImportedItem } from '../src/lib/workspace.ts';
import { MODEL_JOBS_KEY, ModelJobs, readModelJobs } from '../src/lib/model-jobs.ts';

const A = 'B0F2ML48Y6', B = 'B0C4DGFFCM';
const url = (asin: string) => `https://www.amazon.com/dp/${asin}`;
function result(asin = A, status: AmazonModel['status'] = 'pending'): AmazonProductResult {
  return parseAmazonProductResult({
    listing: { asin, title: `Furniture ${asin}`, brand: null, url: url(asin),
      images: ['https://m.media-amazon.com/images/I/furniture.jpg'], price: null, availability: null,
      features: [], dimensionText: null, dimensions: { width: 1.2, height: .75, depth: 1.2 },
      retrievedAt: '2026-10-24T15:45:00.000Z', modelNote: null },
    product: status === 'ready' ? {
      id: `amazon-${asin.toLowerCase()}`, name: `Furniture ${asin}`, category: 'Tables',
      tagline: 'Furniture', description: 'An approximate model', material: 'Oak', background: '#e9ede5',
      dimensions: { width: 1.2, height: .75, depth: 1.2 },
      variants: [{ id: asin, name: 'Original', color: '#808080', asin, productUrl: url(asin),
        modelSrc: `/api/products/models/${asin}/${'a'.repeat(64)}.glb` }],
    } : null,
    model: { status, ...(status === 'ready' ? { source: 'generated' } : {}) },
  }, asin);
}
function item(asin = A, status: AmazonModel['status'] = 'not_requested') {
  const response = result(asin, status);
  return createImportedItem(response.listing, response.product);
}
function memoryStore() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
async function tick(t: TestContext, milliseconds = 0) { t.mock.timers.tick(milliseconds); await flush(); }
function lifecycle(t: TestContext, manager: ModelJobs) {
  t.after(() => manager.stop()); manager.resume(); return manager;
}

test('Browsing unrequested products and cached models never creates generation work', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let starts = 0, checks = 0;
  const manager = lifecycle(t, new ModelJobs({
    generate: async () => { starts++; return result(); },
    check: async () => { checks++; return result(); },
  }));
  manager.track(item());
  manager.track(item(B, 'failed'));
  manager.track(item(A, 'ready'));
  manager.generate(item(A, 'ready'));
  manager.check(B);
  await tick(t, 60000);
  assert.equal(starts, 0); assert.equal(checks, 0);
  assert.deepEqual(manager.getSnapshot(), []);
});

test('Explicit generation is deduplicated by ASIN and continues after the preview unsubscribes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const storage = memoryStore(), response = deferred<AmazonProductResult>();
  let starts = 0, checks = 0, observedSignal: AbortSignal | undefined, readyCount = 0;
  const updates: string[] = [];
  const manager = lifecycle(t, new ModelJobs({ storage, pollDelayMs: 5,
    generate: async (_url, signal) => { starts++; observedSignal = signal; return response.promise; },
    check: async asin => { checks++; return result(asin, 'ready'); },
    onResult: (_id, value) => updates.push(value.listing.model!.status),
    onReady: () => { readyCount++; },
  }));
  const unsubscribe = manager.subscribe(() => {});
  const selected = item();
  manager.generate(selected);
  manager.generate({ ...selected, id: 'new-preview-of-same-asin' });
  unsubscribe(); // A product preview can disappear while the App's manager stays alive.
  assert.equal(starts, 1);
  assert.equal(observedSignal?.aborted, false);
  response.resolve(result()); await flush();
  await tick(t, 5);
  assert.equal(checks, 1); assert.equal(readyCount, 1);
  assert.deepEqual(updates, ['pending', 'ready']);
  const completed = manager.getSnapshot()[0];
  assert.equal(completed.state, 'ready'); assert.equal(completed.item.id, selected.id);
  assert.equal(completed.item.product?.variants[0].asin, A);
  assert.equal(readModelJobs(storage)[0].state, 'ready');
  manager.generate(selected); await tick(t, 100);
  assert.equal(starts, 1, 'An already completed job is not regenerated from an older preview.');
});

test('Different products progress independently and late results retain exact item identities', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = deferred<AmazonProductResult>(), b = deferred<AmazonProductResult>();
  const resolved: { id: string; asin: string }[] = [];
  const originalA = item(A), originalB = item(B);
  const manager = lifecycle(t, new ModelJobs({ pollDelayMs: 100,
    generate: source => source === url(A) ? a.promise : b.promise,
    check: async asin => result(asin, 'ready'),
    onResult: (id, value) => resolved.push({ id, asin: value.listing.asin }),
  }));
  manager.generate(originalA); manager.generate(originalB);
  b.resolve(result(B)); await flush();
  assert.equal(manager.getSnapshot().find(job => job.asin === A)?.state, 'starting');
  manager.check(B); await flush();
  assert.equal(manager.getSnapshot().find(job => job.asin === B)?.state, 'ready');
  a.resolve(result(A)); await flush();
  manager.check(A); await flush();
  assert.deepEqual(new Set(resolved.map(value => `${value.id}:${value.asin}`)), new Set([
    `${originalA.id}:${A}`, `${originalB.id}:${B}`,
  ]));
  assert.ok(manager.getSnapshot().every(job => job.item.listing?.asin === job.asin && job.item.product?.variants[0].asin === job.asin));
});

test('Reloading restores a pending job and checks its status without repeating its POST', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const storage = memoryStore(); let starts = 0, checks = 0;
  const first = lifecycle(t, new ModelJobs({ storage, pollDelayMs: 100,
    generate: async () => { starts++; return result(); },
  }));
  const selected = item(); first.generate(selected); await flush(); first.stop();
  assert.equal(readModelJobs(storage)[0].state, 'pending');
  const restored = lifecycle(t, new ModelJobs({ storage,
    generate: async () => { starts++; return result(); },
    check: async asin => { checks++; return result(asin, 'ready'); },
  }));
  await tick(t);
  assert.equal(starts, 1); assert.equal(checks, 1);
  assert.equal(restored.getSnapshot()[0].state, 'ready');
  assert.equal(restored.getSnapshot()[0].item.id, selected.id);
});

test('Restoring a completed job reconciles saved items once without requests or another completion toast', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const storage = memoryStore(), completed = item(A, 'ready');
  storage.setItem(MODEL_JOBS_KEY, JSON.stringify([{ asin: A, item: completed, state: 'ready', updatedAt: 123 }]));
  let starts = 0, checks = 0, notifications = 0;
  const reconciled: { id: string; result: AmazonProductResult }[] = [];
  const manager = lifecycle(t, new ModelJobs({ storage,
    generate: async () => { starts++; return result(); },
    check: async () => { checks++; return result(); },
    onResult: (id, response) => reconciled.push({ id, result: response }),
    onReady: () => { notifications++; },
  }));
  await tick(t, 100000);
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].id, completed.id);
  assert.equal(reconciled[0].result.listing.asin, A);
  assert.equal(reconciled[0].result.listing.model?.status, 'ready');
  assert.deepEqual(reconciled[0].result.product, completed.product);
  assert.equal(manager.getSnapshot()[0].state, 'ready');
  assert.equal(starts, 0); assert.equal(checks, 0); assert.equal(notifications, 0);
});

test('A saved starting request is reconciled via GET after reload, not automatically resubmitted', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const storage = memoryStore(); let starts = 0, checks = 0;
  storage.setItem(MODEL_JOBS_KEY, JSON.stringify([{ asin: A, item: item(), state: 'starting', updatedAt: 123 }]));
  const manager = lifecycle(t, new ModelJobs({ storage,
    generate: async () => { starts++; return result(); },
    check: async asin => { checks++; return result(asin, 'not_requested'); },
  }));
  await tick(t, 100);
  assert.equal(starts, 0); assert.equal(checks, 1);
  assert.equal(manager.getSnapshot()[0].state, 'failed');
  assert.match(manager.getSnapshot()[0].message!, /not started/);
});

test('A lost start response retries only status and can recover a completed background job', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let starts = 0, checks = 0;
  const manager = lifecycle(t, new ModelJobs({ pollDelayMs: 5,
    generate: async () => { starts++; throw new Error('Connection lost after submission'); },
    check: async asin => { checks++; if (checks === 1) throw new Error('Still offline'); return result(asin, 'ready'); },
  }));
  manager.generate(item()); await flush();
  await tick(t, 5); await tick(t, 5);
  assert.equal(starts, 1); assert.equal(checks, 2);
  assert.equal(manager.getSnapshot()[0].state, 'ready');
});

test('An unknown job after an ambiguous POST requires a fresh explicit generation request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let starts = 0, checks = 0;
  const manager = lifecycle(t, new ModelJobs({ pollDelayMs: 5,
    generate: async () => { starts++; if (starts === 1) throw new Error('Offline'); return result(A, 'ready'); },
    check: async () => { checks++; throw new ImportError('Not found', 'MODEL_NOT_FOUND'); },
  }));
  const selected = item(); manager.generate(selected); await flush(); await tick(t, 5);
  assert.equal(manager.getSnapshot()[0].state, 'failed');
  await tick(t, 10000);
  assert.equal(starts, 1); assert.equal(checks, 1);
  manager.generate(selected); await flush();
  assert.equal(starts, 2); assert.equal(manager.getSnapshot()[0].state, 'ready');
});

test('A mismatched product response cannot complete or overwrite the requested item', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let callbacks = 0, checks = 0;
  const manager = lifecycle(t, new ModelJobs({ pollDelayMs: 5,
    generate: async () => result(B, 'ready'),
    check: async () => { checks++; return result(); },
    onResult: () => { callbacks++; }, onReady: () => { callbacks++; },
  }));
  manager.generate(item(A)); await flush(); await tick(t, 100);
  assert.equal(manager.getSnapshot()[0].state, 'failed');
  assert.equal(manager.getSnapshot()[0].item.listing?.asin, A);
  assert.equal(manager.getSnapshot()[0].item.product, null);
  assert.equal(callbacks, 0); assert.equal(checks, 0);
});

test('Polling deadline pauses checks while retaining the background job for manual resumption', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0, starts = 0, checks = 0;
  const manager = lifecycle(t, new ModelJobs({ now: () => now, maxPollMs: 10, pollDelayMs: 5,
    generate: async () => { starts++; return result(); },
    check: async asin => { checks++; return result(asin, 'ready'); },
  }));
  manager.generate(item()); await flush();
  now = 11; await tick(t, 5);
  assert.equal(manager.getSnapshot()[0].state, 'paused');
  assert.equal(manager.getSnapshot()[0].item.listing?.model?.status, 'pending');
  assert.equal(checks, 0); assert.equal(starts, 1);
  manager.check(A); await flush();
  assert.equal(checks, 1); assert.equal(starts, 1);
  assert.equal(manager.getSnapshot()[0].state, 'ready');
});

test('Repeated network errors pause automatic checking but explicit check resumes without generation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let checks = 0, healthy = false;
  const manager = lifecycle(t, new ModelJobs({ pollDelayMs: 5,
    generate: async () => result(),
    check: async asin => { checks++; if (!healthy) throw new Error('Offline'); return result(asin, 'ready'); },
  }));
  manager.generate(item()); await flush();
  for (let i = 0; i < 4; i++) await tick(t, 5);
  assert.equal(checks, 4); assert.equal(manager.getSnapshot()[0].state, 'paused');
  await tick(t, 1000); assert.equal(checks, 4);
  healthy = true; manager.check(A); await flush();
  assert.equal(manager.getSnapshot()[0].state, 'ready');
});

test('Stopping the app clears polling and ignores late completions; it does not call a provider cancel API', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const response = deferred<AmazonProductResult>();
  let checks = 0, callbacks = 0, signal: AbortSignal | undefined;
  const manager = lifecycle(t, new ModelJobs({ pollDelayMs: 5,
    generate: async (_url, requestSignal) => { signal = requestSignal; return response.promise; },
    check: async () => { checks++; return result(); },
    onResult: () => { callbacks++; }, onReady: () => { callbacks++; },
  }));
  manager.generate(item()); manager.stop();
  assert.equal(signal?.aborted, true);
  response.resolve(result(A, 'ready')); await flush(); await tick(t, 100000);
  assert.equal(callbacks, 0); assert.equal(checks, 0);
  assert.equal(manager.getSnapshot()[0].state, 'starting');
});

test('Tracking accepted pending work starts only status checks, and disabled storage does not stop progress', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let starts = 0, checks = 0;
  const storage = { getItem: () => { throw new Error('Storage blocked'); }, setItem: () => { throw new Error('Storage full'); } };
  const manager = lifecycle(t, new ModelJobs({ storage,
    generate: async () => { starts++; return result(); },
    check: async asin => { checks++; return result(asin, 'ready'); },
  }));
  manager.track(item(A, 'pending')); manager.track(item(A, 'pending'));
  await tick(t);
  assert.equal(starts, 0); assert.equal(checks, 1);
  assert.equal(manager.getSnapshot()[0].state, 'ready');
});

test('Only explicit reopening of an authoritative pending item resumes an inactive tracker, using GET only', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const state of ['paused', 'failed'] as const) {
    const storage = memoryStore(); let starts = 0, checks = 0;
    storage.setItem(MODEL_JOBS_KEY, JSON.stringify([{ asin: A, item: item(A, 'pending'), state, updatedAt: 123 }]));
    const manager = lifecycle(t, new ModelJobs({ storage,
      generate: async () => { starts++; return result(); },
      check: async asin => { checks++; return result(asin, 'ready'); },
    }));
    await tick(t);
    manager.track(item(A, 'pending')); // Ordinary workspace rerenders preserve an intentional pause.
    manager.track(item(A, 'not_requested'), true); // Reopening an unrequested product grants no generation consent.
    await tick(t, 10000);
    assert.equal(manager.getSnapshot()[0].state, state);
    assert.equal(starts, 0); assert.equal(checks, 0);
    const reopened = item(A, 'pending');
    manager.track(reopened, true); manager.track(reopened, true);
    await tick(t);
    assert.equal(manager.getSnapshot()[0].state, 'ready');
    assert.equal(manager.getSnapshot()[0].item.id, reopened.id);
    assert.equal(starts, 0); assert.equal(checks, 1);
    manager.track(item(A, 'pending'), true); await tick(t, 10000);
    assert.equal(manager.getSnapshot()[0].state, 'ready', 'A stale pending import cannot replace a completed tracker.');
    assert.equal(checks, 1); manager.stop();
  }
});

test('An app lifecycle restart ignores a cancelled old response after a fresh status request completes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const oldRequest = deferred<AmazonProductResult>();
  let starts = 0, checks = 0, readyCount = 0;
  const manager = lifecycle(t, new ModelJobs({
    generate: async () => { starts++; return oldRequest.promise; },
    check: async asin => { checks++; return result(asin, 'ready'); },
    onReady: () => { readyCount++; },
  }));
  manager.generate(item()); manager.stop(); manager.resume();
  await tick(t);
  assert.equal(manager.getSnapshot()[0].state, 'ready');
  oldRequest.resolve(result(A, 'pending')); await flush();
  assert.equal(manager.getSnapshot()[0].state, 'ready');
  assert.equal(readyCount, 1); assert.equal(starts, 1); assert.equal(checks, 1);
});

test('A timed-out submission is reconciled with status rather than another generation request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let starts = 0, checks = 0;
  const manager = lifecycle(t, new ModelJobs({ timeoutMs: 10, pollDelayMs: 5,
    generate: async (_url, signal) => {
      starts++;
      return new Promise<AmazonProductResult>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
    },
    check: async asin => { checks++; return result(asin, 'ready'); },
  }));
  manager.generate(item());
  await tick(t, 10); await tick(t, 5);
  assert.equal(starts, 1); assert.equal(checks, 1);
  assert.equal(manager.getSnapshot()[0].state, 'ready');
});

test('Restored jobs reject mismatched identities, corrupt items and duplicate ASINs', () => {
  const storage = memoryStore(), valid = { asin: A, item: item(A, 'pending'), state: 'pending', updatedAt: 123, message: 'untrusted message' };
  storage.setItem(MODEL_JOBS_KEY, JSON.stringify([
    { ...valid, asin: B }, { ...valid, item: {} }, { ...valid, state: 'ready' }, valid, valid,
  ]));
  const restored = readModelJobs(storage);
  assert.equal(restored.length, 1); assert.equal(restored[0].asin, A);
  assert.equal(restored[0].message, undefined);
  storage.setItem(MODEL_JOBS_KEY, '{broken json'); assert.deepEqual(readModelJobs(storage), []);
});
