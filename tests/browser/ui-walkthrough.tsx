import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import App from '../../src/App';
import { GENERATION_STORAGE_KEY } from '../../src/lib/reconstruction';
import type { GenerationStatus } from '../../src/lib/reconstruction';
import { MODEL_JOBS_KEY } from '../../src/lib/model-jobs';
import { createImportedItem, createLayout, placeItem, placeholderProduct, WORKSPACE_KEY } from '../../src/lib/workspace';
import type { Workspace } from '../../src/lib/workspace';
import { parseRoomScan } from '../../src/lib/room-scan';
import type { AmazonListing, AmazonModel, AmazonProductResult } from '../../src/lib/amazon';
import roomScan from '../fixtures/room-scan.json';
import '../../src/styles.css';

// Manual fixture only: it is not imported by index.html or any production module.
const FIXTURE_KEY = 'furniture-ar:test:ui-walkthrough:v1';
const PHOTO_TICKET = 'ui-walkthrough.simulated-signature';
const ASINS = ['B0QA000001', 'B0QA000002', 'B0QA000003', 'B0QA000004', 'B0QA000005'];
const IMAGE_PREFIX = 'https://ui-walkthrough.invalid/';
const nativeFetch = window.fetch.bind(window);
const report = document.querySelector<HTMLOutputElement>('#fixture-report')!;
const cameraMode = document.querySelector<HTMLSelectElement>('#camera-mode')!;
const apiMode = document.querySelector<HTMLSelectElement>('#api-mode')!;
const photoState = document.querySelector<HTMLSelectElement>('#photo-state')!;
const amazonState = document.querySelector<HTMLSelectElement>('#amazon-state')!;
type Snapshot = Record<string, string>;
type FixtureState = { active: boolean; local: Snapshot; session: Snapshot; requests: number; blocked: number; message: string; photoStatus: GenerationStatus; amazonStatus: string; camera: string; api: string; started: string[] };
function snapshot(storage: Storage): Snapshot {
  return Object.fromEntries(Object.keys(storage).filter(key => key.startsWith('furniture-ar:') && key !== FIXTURE_KEY).map(key => [key, storage.getItem(key)!]));
}
function restore(storage: Storage, original: Snapshot) {
  for (const key of Object.keys(storage)) if (key.startsWith('furniture-ar:') && key !== FIXTURE_KEY) storage.removeItem(key);
  for (const [key, value] of Object.entries(original)) storage.setItem(key, value);
}
let state: FixtureState;
try { state = JSON.parse(sessionStorage.getItem(FIXTURE_KEY) || 'null'); } catch { state = null!; }
const recovering = !!state?.active;
if (!recovering) state = { active: true, local: snapshot(localStorage), session: snapshot(sessionStorage), requests: 0, blocked: 0, message: 'Sample workspace loaded.', photoStatus: 'processing', amazonStatus: 'auto', camera: 'simulated', api: 'normal', started: [] };
let root: Root | null = null;
function refresh(message?: string) {
  if (message) state.message = message;
  if (state.active) sessionStorage.setItem(FIXTURE_KEY, JSON.stringify(state));
  report.textContent = `${state.active ? 'Simulation active' : 'Original data restored; app stopped'} · ${state.requests} simulated API calls · ${state.blocked} blocked requests · ${state.message}`;
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
function chosenStatus(asin: string): AmazonModel['status'] {
  if (state.amazonStatus !== 'auto') return state.amazonStatus as AmazonModel['status'];
  if (state.started.includes(asin)) return 'pending';
  return ({ B0QA000001: 'ready', B0QA000002: 'not_requested', B0QA000003: 'pending', B0QA000004: 'failed', B0QA000005: 'storage_unavailable' } as const)[asin as typeof ASINS[number]] || 'not_requested';
}
function productResult(asin: string, status = chosenStatus(asin)): AmazonProductResult {
  const name = ({ B0QA000001: 'QA oak table', B0QA000002: 'QA unmodeled table', B0QA000003: 'QA generating table', B0QA000004: 'QA failed table', B0QA000005: 'QA paused table' } as Record<string, string>)[asin] || 'QA imported table';
  const listing: AmazonListing = {
    asin, title: name, brand: 'Simulated furniture', url: `https://www.amazon.com/dp/${asin}`,
    images: [`${IMAGE_PREFIX}front.jpg`, `${IMAGE_PREFIX}side.jpg`], price: { amount: 199, currency: 'USD', display: '$199.00' }, availability: 'In stock (simulated)',
    features: ['Synthetic UI fixture'], dimensionText: '120 × 120 × 75 cm', dimensions: { ...placeholderProduct.dimensions }, retrievedAt: new Date().toISOString(),
    modelNote: status === 'ready' ? 'Synthetic fixture using the local sample table.' : null,
    colors: { status: 'observed', options: [
      { asin, name: 'Oak', url: `https://www.amazon.com/dp/${asin}`, imageUrl: `${IMAGE_PREFIX}front.jpg`, selected: true },
      { asin: 'B0QA000006', name: 'Black', url: 'https://www.amazon.com/dp/B0QA000006', imageUrl: `${IMAGE_PREFIX}side.jpg`, selected: false },
    ] }, model: { status, ...(status === 'ready' ? { source: 'registered' } : {}), ...(status === 'pending' ? { stage: 'reconstructing', retryAfterMs: 3000 } : {}) },
  };
  const product = status === 'ready' ? {
    ...placeholderProduct, id: `qa-${asin.toLowerCase()}`, name,
    variants: [
      { ...placeholderProduct.variants[0], asin, productUrl: listing.url },
      { ...placeholderProduct.variants[1], asin: 'B0QA000006', productUrl: 'https://www.amazon.com/dp/B0QA000006' },
    ],
  } : null;
  return { listing, product };
}
function sampleWorkspace(): Workspace {
  const items = ASINS.map(asin => { const result = productResult(asin, asin === ASINS[0] ? 'ready' : chosenStatus(asin)); return createImportedItem(result.listing, result.product); });
  const room = placeItem(createLayout('QA living room', 'Living room'), items[0]);
  const scan = parseRoomScan(roomScan);
  const scanned = placeItem({ ...createLayout('QA scanned room', 'Scanned room', scan.width, scan.depth), survey: scan.survey }, items[0]);
  return { items, layouts: [room, scanned, createLayout('QA empty room', 'Bedroom', 4, 3)] };
}
function mount(photo = false) {
  root?.unmount(); root = null;
  const url = new URL(location.href); url.searchParams.delete('photo'); if (photo) url.searchParams.set('photo', '1'); url.hash = '';
  history.replaceState(null, '', url);
  root = createRoot(document.querySelector<HTMLDivElement>('#root')!); root.render(<App />); refresh();
}
function activate() {
  if (state.active) return;
  state = { ...state, active: true, local: snapshot(localStorage), session: snapshot(sessionStorage), requests: 0, blocked: 0 };
}
function seed(empty: boolean) {
  root?.unmount(); root = null; activate(); state.started = []; state.amazonStatus = 'auto'; amazonState.value = 'auto';
  const workspace = empty ? { layouts: [], items: [] } : sampleWorkspace();
  localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace)); localStorage.setItem('furniture-ar:unit', 'cm');
  localStorage.setItem(MODEL_JOBS_KEY, JSON.stringify(empty ? [] : workspace.items.filter(item => item.listing?.asin !== ASINS[1]).map(item => ({ asin: item.listing!.asin, item, state: item.product ? 'ready' : item.listing!.model?.status === 'failed' ? 'failed' : item.listing!.model?.status === 'storage_unavailable' ? 'paused' : 'pending', updatedAt: Date.now() }))));
  sessionStorage.removeItem(GENERATION_STORAGE_KEY); refresh(empty ? 'Empty workspace loaded.' : 'Sample workspace loaded.'); mount();
}

// Canvas photos and video are synthetic. The real camera API is never called.
const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
const context = canvas.getContext('2d')!;
function drawCamera() {
  context.fillStyle = '#eee8de'; context.fillRect(0, 0, 800, 600);
  context.fillStyle = '#b89a71'; context.beginPath(); context.ellipse(400, 260, 230, 80, 0, 0, Math.PI * 2); context.fill();
  context.fillStyle = '#765a3c'; context.fillRect(335, 285, 30, 220); context.fillRect(445, 285, 30, 220);
  context.fillStyle = '#24352b'; context.font = 'bold 28px system-ui'; context.fillText('SIMULATED CAMERA · NO DEVICE ACCESS', 64, 64);
  context.font = '20px system-ui'; context.fillText('Synthetic test furniture', 280, 560);
}
drawCamera();
const image = canvas.toDataURL('image/png');
const originalSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
Object.defineProperty(HTMLImageElement.prototype, 'src', { ...originalSrc, set(value: string) { originalSrc.set!.call(this, String(value).startsWith(IMAGE_PREFIX) ? image : value); } });
const nativeSetAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (name: string, value: string) { nativeSetAttribute.call(this, name, this instanceof HTMLImageElement && name.toLowerCase() === 'src' && String(value).startsWith(IMAGE_PREFIX) ? image : value); };
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
  if (state.camera === 'denied') throw new DOMException('Simulated permission denial', 'NotAllowedError');
  drawCamera(); const stream = canvas.captureStream(10); const timer = window.setInterval(drawCamera, 100);
  const track = stream.getVideoTracks()[0], stop = track.stop.bind(track); track.stop = () => { clearInterval(timer); stop(); };
  refresh('Synthetic camera opened.'); return stream;
} });

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const signal = init?.signal || (input instanceof Request ? input.signal : undefined); signal?.throwIfAborted();
  if (url.pathname.startsWith('/api/')) {
    state.requests++; refresh();
    if (state.api === 'slow') await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 5000); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); });
    signal?.throwIfAborted();
    if (state.api === 'error') return json({ error: { code: 'SERPAPI_UNAVAILABLE', message: 'Simulated service interruption. Change API to Success and retry.' } }, 503);
    if (url.pathname === '/api/reconstruction/config' && method === 'GET') return json({ configured: true, signedIn: true });
    if (url.pathname === '/api/reconstruction/jobs' && method === 'POST') return json({ ticket: PHOTO_TICKET, status: state.photoStatus, stage: 'reconstructing' });
    if (/^\/api\/reconstruction\/jobs\/[^/]+\/model$/.test(url.pathname) && method === 'GET') return nativeFetch('/models/little-tree-oak-table.glb', { signal });
    if (/^\/api\/reconstruction\/jobs\/[^/]+$/.test(url.pathname) && method === 'GET') return json({ ticket: decodeURIComponent(url.pathname.split('/').at(-1)!), status: state.photoStatus, stage: 'reconstructing', progress: state.photoStatus === 'processing' ? 42 : undefined });
    let body: Record<string, unknown> = {};
    if (method === 'POST') { try { body = JSON.parse(typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : '{}'); } catch { /* Handled as invalid input below. */ } }
    if (url.pathname === '/api/products/search' && method === 'POST') {
      const q = String(body.q || 'table'), page = Number(body.page) || 1;
      const asins = state.api === 'empty' ? [] : ASINS.slice(page === 1 ? 0 : 2, page === 1 ? 2 : 4);
      return json({ query: q, page, nextPage: page === 1 && asins.length ? 2 : null, totalResults: state.api === 'empty' ? 0 : 4, retrievedAt: new Date().toISOString(), providerRetrievedAt: null, cached: false,
        products: asins.map(asin => { const result = productResult(asin); return { asin, title: result.listing.title, url: result.listing.url, imageUrl: `${IMAGE_PREFIX}front.jpg`, price: result.listing.price, rating: 4.6, ratingsTotal: 128, availability: result.listing.availability, modelAvailable: !!result.product }; }) });
    }
    if (url.pathname === '/api/products/import' && method === 'POST') {
      const value = String(body.url || ''), asin = value.match(/(?:\/dp\/|\/gp\/product\/)?([a-z0-9]{10})(?:[/?#]|$)/i)?.[1].toUpperCase();
      if (!asin) return json({ error: { code: 'INVALID_LINK' } }, 400);
      if (body.generateModel === true && !state.started.includes(asin)) state.started.push(asin);
      refresh(); return json(productResult(asin));
    }
    const modelAsin = url.pathname.match(/^\/api\/products\/models\/([A-Z0-9]{10})$/)?.[1];
    if (modelAsin && method === 'GET') return json(productResult(modelAsin));
    state.blocked++; refresh(`Blocked unexpected API: ${method} ${url.pathname}`); return json({ error: { code: 'FIXTURE_BLOCKED', message: 'This API is not simulated.' } }, 409);
  }
  if (['GET', 'HEAD'].includes(method) && (url.origin === location.origin || ['blob:', 'data:'].includes(url.protocol))) return nativeFetch(input, init);
  state.blocked++; refresh(`Blocked external request: ${url.origin}`); return json({ error: { code: 'FIXTURE_BLOCKED', message: 'External requests are blocked in this fixture.' } }, 409);
};
// Let React handle the scan-step transition while suppressing actual navigation.
document.addEventListener('click', event => {
  const anchor = (event.target as Element | null)?.closest('a'); if (!anchor) return;
  const url = new URL(anchor.href, location.href);
  if (url.protocol === 'furniturear-scan:') { event.preventDefault(); refresh('Native scanner launch simulated.'); }
  else if (['http:', 'https:'].includes(url.protocol) && url.origin !== location.origin) { event.preventDefault(); refresh(`External link simulated: ${url.href}`); }
});
for (const [control, key] of [[cameraMode, 'camera'], [apiMode, 'api'], [photoState, 'photoStatus'], [amazonState, 'amazonStatus']] as const) {
  control.value = state[key]; control.addEventListener('change', () => { (state[key] as string) = control.value; refresh(`Simulation changed: ${control.labels?.[0]?.textContent?.split(' ')[0]} → ${control.value}`); });
}
document.querySelector('#seed-samples')!.addEventListener('click', () => seed(false));
document.querySelector('#seed-empty')!.addEventListener('click', () => seed(true));
document.querySelector('#load-photo-job')!.addEventListener('click', () => {
  root?.unmount(); root = null; activate(); sessionStorage.setItem(GENERATION_STORAGE_KEY, JSON.stringify({ ticket: PHOTO_TICKET, status: state.photoStatus, stage: 'reconstructing', startedAt: Date.now() - 30_000 })); refresh('Photo job seeded 30 seconds ago.'); mount(true);
});
document.querySelector('#reset-photo')!.addEventListener('click', () => { root?.unmount(); root = null; activate(); sessionStorage.removeItem(GENERATION_STORAGE_KEY); mount(true); refresh('Photo flow reset.'); });
document.querySelector('#restore-data')!.addEventListener('click', () => {
  root?.unmount(); root = null; if (state.active) { restore(localStorage, state.local); restore(sessionStorage, state.session); }
  state.active = false; sessionStorage.removeItem(FIXTURE_KEY); refresh('Original browser data restored.');
});
document.querySelector('#download-photo')!.addEventListener('click', () => { const link = document.createElement('a'); link.href = image; link.download = 'ui-synthetic-furniture.png'; link.click(); refresh('Synthetic photo downloaded for upload testing.'); });
if (recovering) mount(new URL(location.href).searchParams.has('photo'));
else seed(false);
