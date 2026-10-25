import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERATION_STORAGE_KEY,
  generationElapsedSeconds,
  readPendingGeneration,
  rememberGeneration,
  trackGeneration,
} from '../src/lib/reconstruction.ts';
import type { GenerationJob } from '../src/lib/reconstruction.ts';

const startedAt = 1_000_000;
const queued: GenerationJob = { ticket: 'first-job.signature', status: 'queued' };

function withStorage(t: TestContext, options: { failRead?: boolean; failWrite?: boolean } = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const values = new Map<string, string>();
  const calls = { writes: 0, removals: 0 };
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem(key: string) {
      if (options.failRead) throw new Error('Storage access denied');
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      calls.writes++;
      if (options.failWrite) throw new Error('Storage quota exceeded');
      values.set(key, value);
    },
    removeItem(key: string) {
      calls.removals++;
      if (options.failWrite) throw new Error('Storage access denied');
      values.delete(key);
    },
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  });
  return { values, calls };
}

test('Returning to a processing photo after navigation includes time spent on another page', t => {
  withStorage(t);
  const submitted = trackGeneration(queued, null, startedAt);
  const processing = trackGeneration({ ...queued, status: 'processing', stage: 'reconstructing' }, submitted, startedAt + 30_000);
  assert.equal(generationElapsedSeconds(processing.startedAt, startedAt + 30_000), 30);
  rememberGeneration(processing);

  // The view is recreated from persisted state after twenty seconds elsewhere.
  const restored = readPendingGeneration(startedAt + 50_000);
  assert.ok(restored);
  assert.equal(restored.ticket, submitted.ticket);
  assert.equal(restored.status, 'processing');
  assert.equal(restored.stage, 'reconstructing');
  assert.equal(restored.startedAt, startedAt);
  assert.equal(generationElapsedSeconds(restored.startedAt, startedAt + 50_000), 50);

  // A subsequent page refresh uses the same original starting point.
  const refreshed = readPendingGeneration(startedAt + 80_000);
  assert.equal(generationElapsedSeconds(refreshed?.startedAt, startedAt + 80_000), 80);
});

test('Status polls, repeated results and a resumed check retain the task start time', () => {
  let pending = trackGeneration(queued, null, startedAt);
  const responses: GenerationJob[] = [
    { ...queued, status: 'processing', stage: 'preparing' },
    { ...queued, status: 'processing', stage: 'reconstructing', progress: 25 },
    { ...queued, status: 'processing', stage: 'reconstructing', progress: 25 },
    { ...queued, status: 'processing', stage: 'texturing', progress: 70 },
    { ...queued, status: 'succeeded', stage: 'exporting', progress: 100 },
  ];
  for (const [index, response] of responses.entries()) {
    const before = pending;
    pending = trackGeneration(response, pending, startedAt + (index + 1) * 60_000);
    assert.equal(pending.startedAt, startedAt);
    assert.equal(pending.status, response.status);
    assert.equal(pending.stage, response.stage);
    assert.equal(pending.progress, response.progress);
    assert.equal(before.startedAt, startedAt);
  }
  assert.equal(generationElapsedSeconds(pending.startedAt, startedAt + 300_000), 300);
});

test('A different generation gets a new clock and clearing a task removes its persisted clock', t => {
  const { values } = withStorage(t);
  const first = trackGeneration(queued, null, startedAt);
  const second = trackGeneration({ ticket: 'second-job.signature', status: 'queued' }, first, startedAt + 90_000);
  assert.equal(second.startedAt, startedAt + 90_000);
  assert.equal(generationElapsedSeconds(second.startedAt, startedAt + 90_000), 0);
  rememberGeneration(second);
  assert.equal(readPendingGeneration(startedAt + 100_000)?.ticket, second.ticket);
  rememberGeneration(null);
  assert.equal(values.has(GENERATION_STORAGE_KEY), false);
  assert.equal(readPendingGeneration(startedAt + 100_000), null);
  assert.equal(generationElapsedSeconds(trackGeneration(queued, null, startedAt + 120_000).startedAt, startedAt + 120_000), 0);
});

test('Background timer throttling cannot lose elapsed time and partial seconds are rounded down', () => {
  const pending = trackGeneration(queued, null, startedAt);
  assert.equal(generationElapsedSeconds(pending.startedAt, startedAt + 999), 0);
  assert.equal(generationElapsedSeconds(pending.startedAt, startedAt + 1_999), 1);
  // No interval callbacks have run during the five-minute gap.
  assert.equal(generationElapsedSeconds(pending.startedAt, startedAt + 300_999), 300);
});

test('An existing task without timing data is migrated once and keeps that time on later visits', t => {
  const { values, calls } = withStorage(t);
  values.set(GENERATION_STORAGE_KEY, JSON.stringify({ ...queued, status: 'processing' }));
  const firstVisit = readPendingGeneration(startedAt);
  assert.ok(firstVisit);
  assert.equal(firstVisit.startedAt, startedAt);
  assert.equal(calls.writes, 1);
  const nextVisit = readPendingGeneration(startedAt + 50_000);
  assert.equal(nextVisit?.startedAt, startedAt);
  assert.equal(generationElapsedSeconds(nextVisit?.startedAt, startedAt + 50_000), 50);
  assert.equal(calls.writes, 1);
});

test('Invalid or future stored timestamps are repaired once without dropping the active task', t => {
  const { values, calls } = withStorage(t);
  for (const invalid of [null, -100, '1000', 'NaN', {}, startedAt + 60_000]) {
    values.set(GENERATION_STORAGE_KEY, JSON.stringify({ ...queued, startedAt: invalid }));
    const writesBefore = calls.writes;
    const repaired = readPendingGeneration(startedAt);
    assert.equal(repaired?.ticket, queued.ticket);
    assert.equal(repaired?.startedAt, startedAt);
    assert.equal(calls.writes, writesBefore + 1);
    assert.equal(readPendingGeneration(startedAt + 10_000)?.startedAt, startedAt);
    assert.equal(calls.writes, writesBefore + 1);
  }
});

test('Malformed persisted jobs cannot enter the generation view', t => {
  const { values } = withStorage(t);
  for (const raw of ['{broken', 'null', '[]', '{}', JSON.stringify({ ...queued, ticket: '../invalid', startedAt }), JSON.stringify({ ...queued, status: 'unknown', startedAt })]) {
    values.set(GENERATION_STORAGE_KEY, raw);
    assert.equal(readPendingGeneration(startedAt), null);
  }
});

test('Denied storage reads safely return no saved task while in-memory timing still works', t => {
  withStorage(t, { failRead: true });
  assert.equal(readPendingGeneration(startedAt), null);
  const pending = trackGeneration(queued, null, startedAt);
  assert.equal(generationElapsedSeconds(pending.startedAt, startedAt + 20_000), 20);
});

test('Storage write failures do not block restored jobs, active timing or task reset', t => {
  const { values } = withStorage(t, { failWrite: true });
  values.set(GENERATION_STORAGE_KEY, JSON.stringify(queued));
  const migrated = readPendingGeneration(startedAt);
  assert.equal(migrated?.ticket, queued.ticket);
  assert.equal(migrated?.startedAt, startedAt);
  assert.doesNotThrow(() => rememberGeneration(migrated));
  assert.doesNotThrow(() => rememberGeneration(null));
  assert.equal(generationElapsedSeconds(migrated?.startedAt, startedAt + 20_000), 20);
});

test('Missing, invalid and future timestamps never display negative or non-finite seconds', () => {
  for (const invalid of [undefined, null, NaN, Infinity, -Infinity, startedAt + 1_000]) {
    assert.equal(generationElapsedSeconds(invalid, startedAt), 0);
  }
});
