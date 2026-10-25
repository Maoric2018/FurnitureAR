import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import App from '../../src/App';
import { GENERATION_STORAGE_KEY } from '../../src/lib/reconstruction';
import '../../src/styles.css';

// This file is a manual browser fixture, never the production application entry.
const FIXTURE_KEY = 'furniture-ar:test:generation-timer:v1';
const TICKET = 'timer-regression-fixture.simulated-signature';
type FixtureState = {
  active: boolean;
  clockOffset: number;
  createRequests: number;
  statusRequests: number;
  blockedRequests: number;
  originalJob: string | null;
};
const realNow = Date.now.bind(Date);
const nativeFetch = window.fetch.bind(window);
function readState(): FixtureState {
  try {
    const value = JSON.parse(sessionStorage.getItem(FIXTURE_KEY) || 'null');
    if (value?.active === true && Number.isFinite(value.clockOffset)) return {
      active: true, clockOffset: value.clockOffset,
      createRequests: Number(value.createRequests) || 0,
      statusRequests: Number(value.statusRequests) || 0,
      blockedRequests: Number(value.blockedRequests) || 0,
      originalJob: typeof value.originalJob === 'string' ? value.originalJob : null,
    };
  } catch { /* A broken fixture state starts a new isolated run. */ }
  return { active: false, clockOffset: 0, createRequests: 0, statusRequests: 0, blockedRequests: 0, originalJob: null };
}
let state = readState();
Date.now = () => realNow() + state.clockOffset;
const report = document.querySelector<HTMLPreElement>('#timer-report')!;
const advance = document.querySelector<HTMLButtonElement>('#advance-clock')!;
let root: Root | null = null;
function persistState() {
  if (state.active) sessionStorage.setItem(FIXTURE_KEY, JSON.stringify(state));
}
function refreshReport() {
  let stored: { ticket?: string; startedAt?: number } | null = null;
  try { stored = JSON.parse(sessionStorage.getItem(GENERATION_STORAGE_KEY) || 'null'); } catch { /* Show invalid data as missing. */ }
  const startedAt = stored?.startedAt;
  const expectedElapsed = typeof startedAt === 'number' ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : null;
  const displayedElapsed = document.querySelector('.photo-elapsed')?.textContent?.trim() || '(Photo to 3D is not showing a processing timer)';
  report.dataset.failed = String(state.createRequests > 0 || state.blockedRequests > 0);
  report.textContent = [
    `Fixture: ${state.active ? 'active — polling responses intentionally omit startedAt' : 'cleared / not loaded'}`,
    `POST create requests: ${state.createRequests} (must stay 0; all creation requests are blocked)`,
    `GET job status requests: ${state.statusRequests}`,
    `Other blocked API requests: ${state.blockedRequests}`,
    `Clock offset: ${state.clockOffset / 1000} seconds`,
    `Stored ticket: ${stored?.ticket || '(none)'}`,
    `Stored startedAt: ${startedAt ?? '(none)'}`,
    `Expected elapsed: ${expectedElapsed === null ? '(none)' : `${expectedElapsed} seconds`}`,
    `Real app timer: ${displayedElapsed}`,
  ].join('\n');
  advance.disabled = !state.active;
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
  signal?.throwIfAborted();
  if (url.origin === location.origin && url.pathname === '/api/reconstruction/config' && method === 'GET') {
    return json({ configured: true, signedIn: true });
  }
  if (url.origin === location.origin && url.pathname === '/api/reconstruction/jobs' && method === 'POST') {
    state.createRequests++;
    persistState(); refreshReport();
    return json({ error: { code: 'FIXTURE_BLOCKED', message: 'FAIL: generation creation was blocked by the timer fixture. No GPU request was sent.' } }, 409);
  }
  if (url.origin === location.origin && url.pathname === `/api/reconstruction/jobs/${encodeURIComponent(TICKET)}` && method === 'GET') {
    state.statusRequests++;
    persistState(); refreshReport();
    // Deliberately do not include startedAt. The real client must retain its own.
    return json({ ticket: TICKET, status: 'processing', stage: 'reconstructing' });
  }
  // Only static same-origin reads are allowed through. This prevents a manual
  // click elsewhere in the real app from accidentally starting paid work.
  if (url.origin === location.origin && !url.pathname.startsWith('/api/') && ['GET', 'HEAD'].includes(method)) {
    return nativeFetch(input, init);
  }
  state.blockedRequests++;
  persistState(); refreshReport();
  return json({ error: { code: 'FIXTURE_BLOCKED', message: `This timer fixture blocks non-fixture API requests: ${method} ${url.pathname}` } }, 409);
};
function remountPhoto() {
  root?.unmount();
  const url = new URL(location.href);
  url.searchParams.set('photo', '1');
  url.hash = '';
  history.replaceState(null, '', url);
  root = createRoot(document.querySelector<HTMLDivElement>('#root')!);
  root.render(<App />);
  refreshReport();
}
document.querySelector<HTMLButtonElement>('#load-processing')!.addEventListener('click', () => {
  root?.unmount(); root = null;
  const originalJob = state.active ? state.originalJob : sessionStorage.getItem(GENERATION_STORAGE_KEY);
  state = { active: true, clockOffset: 0, createRequests: 0, statusRequests: 0, blockedRequests: 0, originalJob };
  sessionStorage.setItem(GENERATION_STORAGE_KEY, JSON.stringify({ ticket: TICKET, status: 'processing', stage: 'reconstructing', startedAt: Date.now() - 30_000 }));
  persistState(); remountPhoto();
});
advance.addEventListener('click', () => {
  if (!state.active) return;
  state.clockOffset += 20_000;
  persistState();
  document.dispatchEvent(new Event('visibilitychange'));
  refreshReport();
});
document.querySelector<HTMLButtonElement>('#clear-fixture')!.addEventListener('click', () => {
  root?.unmount(); root = null;
  if (state.active) {
    if (state.originalJob === null) sessionStorage.removeItem(GENERATION_STORAGE_KEY);
    else sessionStorage.setItem(GENERATION_STORAGE_KEY, state.originalJob);
  }
  sessionStorage.removeItem(FIXTURE_KEY);
  state = { active: false, clockOffset: 0, createRequests: 0, statusRequests: 0, blockedRequests: 0, originalJob: null };
  const url = new URL(location.href); url.searchParams.delete('photo'); history.replaceState(null, '', url);
  root = createRoot(document.querySelector<HTMLDivElement>('#root')!); root.render(<App />);
  refreshReport();
});
if (state.active) remountPhoto();
else {
  // Start at Overview so a pre-existing real pending job is not consumed.
  const url = new URL(location.href); url.searchParams.delete('photo'); history.replaceState(null, '', url);
  root = createRoot(document.querySelector<HTMLDivElement>('#root')!); root.render(<App />);
  refreshReport();
}
setInterval(refreshReport, 250);
