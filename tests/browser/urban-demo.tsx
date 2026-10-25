import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { ModelViewerElement } from '@google/model-viewer';
import App from '../../src/App';
import { createLayout, WORKSPACE_KEY } from '../../src/lib/workspace';
import type { RoomLayout, Workspace } from '../../src/lib/workspace';
import { MODEL_JOBS_KEY } from '../../src/lib/model-jobs';
import '../../src/styles.css';

// Test-only entry point: drive the original UI against the real same-origin Worker.
const SNAPSHOT_KEY = 'furniture-ar:test:urban-demo:snapshot';
const STARTING_ROOM_ID = 'room-designer-workflow-qa';
const BRIEF_KEY = `furniture-ar:design:${STARTING_ROOM_ID}`;
const storageKeys = [WORKSPACE_KEY, MODEL_JOBS_KEY, BRIEF_KEY];
const report = document.querySelector<HTMLPreElement>('#urban-demo-report')!;
const run = document.querySelector<HTMLButtonElement>('#run-urban-checks')!;
const restore = document.querySelector<HTMLButtonElement>('#restore-urban-workspace')!;
const app = document.querySelector<HTMLDivElement>('#root')!;
let root: Root | null = null, running = false;
let blockedRequests: string[] = [], messages: string[] = [];
let designRequests: string[] = [];
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.origin === location.origin && url.pathname === '/api/design/room') {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method === 'GET' || method === 'POST') {
      designRequests.push(method);
      return realFetch(input, init);
    }
  }
  if (url.pathname.startsWith('/api/') || url.origin !== location.origin) {
    blockedRequests.push(`${url.origin}${url.pathname}`);
    return new Response(JSON.stringify({ error: { code: 'FIXTURE_BLOCKED', message: 'Designer QA permits only the room-design API.' } }), {
      status: 409, headers: { 'Content-Type': 'application/json' },
    });
  }
  return realFetch(input, init);
};
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function pass(message: string) { messages.push(`PASS ${message}`); report.textContent = messages.join('\n'); }
const pause = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition: () => unknown, message: string, timeout = 12_000) {
  const start = performance.now();
  while (!condition()) {
    if (performance.now() - start > timeout) throw new Error(`Timed out: ${message}`);
    await pause();
  }
}
function workspace(): Workspace { return JSON.parse(localStorage.getItem(WORKSPACE_KEY) || '{"layouts":[],"items":[]}'); }
function room(id: string): RoomLayout {
  const value = workspace().layouts.find(layout => layout.id === id);
  check(value, `Missing saved layout ${id}`); return value;
}
function findButton(name: string, within: ParentNode = app): HTMLButtonElement | undefined {
  return [...within.querySelectorAll<HTMLButtonElement>('button')].find(element =>
    [element.getAttribute('aria-label'), element.title, element.textContent?.trim()].includes(name));
}
async function click(name: string, within: ParentNode = app) {
  const element = findButton(name, within);
  check(element, `Missing button: ${name}`); check(!element.disabled, `Disabled button: ${name}`);
  element.click(); await pause();
}
function dialog() {
  const element = app.querySelector<HTMLDialogElement>('dialog[open][aria-label="Design my room"]');
  check(element, 'Missing open design dialog'); return element;
}
function prompt(value: string) {
  const label = [...dialog().querySelectorAll('label')].find(element => element.textContent?.startsWith('What would make this room better?'));
  const textarea = label?.querySelector('textarea');
  check(textarea && !textarea.disabled, 'Room design prompt is unavailable');
  // React tracks controlled values, so use the native setter and a real input event.
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}
function cards() { return [...dialog().querySelectorAll<HTMLButtonElement>('button.designer-option')]; }
function pieces(card: ParentNode) { return [...card.querySelectorAll<SVGGElement>('[data-piece-id]')]; }
function geometry(card: ParentNode) { return JSON.stringify(pieces(card).map(piece => [piece.getAttribute('transform'), piece.dataset.elevation])); }
const modeLabel = /\bdemo\b|\bprepared\b|live\s+(?:claude|ai|generation)[^.!?]{0,25}\boff\b/i;
function noModeLabels(where: string) {
  const accessible = [...app.querySelectorAll('[aria-label], [title], [alt]')].flatMap(element =>
    ['aria-label', 'title', 'alt'].map(attribute => element.getAttribute(attribute) || ''));
  const values = [...app.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')].map(element => element.value);
  check(!modeLabel.test([app.innerText, ...accessible, ...values].join('\n')), `Mode labels remain visible or accessible in ${where}`);
}
function noModeMetadata(layout: RoomLayout) {
  const displayText = [layout.name, layout.roomType, ...layout.items.flatMap(item => [item.name, item.product.name,
    item.product.tagline, item.product.description, ...item.product.variants.map(variant => variant.name)])];
  check(!modeLabel.test(displayText.join('\n')), `Mode labels remain in public layout/product metadata: ${layout.id}`);
}
function mount() { root?.unmount(); root = createRoot(app); root.render(<StrictMode><App /></StrictMode>); }
function saveOriginal() {
  if (!sessionStorage.getItem(SNAPSHOT_KEY)) {
    sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(Object.fromEntries(storageKeys.map(key => [key, localStorage.getItem(key)]))));
  }
}
function clearFixture() {
  root?.unmount(); root = null;
  const snapshot = sessionStorage.getItem(SNAPSHOT_KEY);
  if (snapshot) {
    for (const [key, value] of Object.entries(JSON.parse(snapshot) as Record<string, string | null>)) {
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    }
    sessionStorage.removeItem(SNAPSHOT_KEY);
  }
  history.replaceState(null, '', location.pathname);
  report.dataset.status = 'idle'; report.textContent = 'Original workspace restored. Fixture app unmounted.';
  run.disabled = false;
}
restore.addEventListener('click', () => { if (!running) clearFixture(); });
run.addEventListener('click', async () => {
  if (running) return;
  running = true; run.disabled = true; restore.disabled = true;
  messages = []; blockedRequests = []; designRequests = []; report.dataset.status = 'running'; report.textContent = 'Running the original production designer…';
  try {
    root?.unmount(); root = null; saveOriginal();
    const existing = { ...createLayout('QA existing room — preserve me', 'Bedroom', 4.5, 3.5), id: STARTING_ROOM_ID };
    const legacy = { ...createLayout('Urban High-Rise · Demo', 'Demo · urban high-rise', 3.42, 3.63), id: 'roomify-urban-furnished-demo-v1' };
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ layouts: [existing, legacy], items: [] }));
    localStorage.removeItem(MODEL_JOBS_KEY);
    localStorage.removeItem(BRIEF_KEY);
    history.replaceState(null, '', `${location.pathname}?layout=${encodeURIComponent(existing.id)}`);
    mount(); await until(() => app.querySelector<HTMLInputElement>('input[aria-label="Layout name"]')?.value === existing.name, 'normal starting room');
    await until(() => !modeLabel.test(`${room(legacy.id).name} ${room(legacy.id).roomType}`), 'legacy labels migrated');
    noModeLabels('starting editor'); noModeMetadata(room(legacy.id));
    await click('Design my room');
    await until(() => app.querySelector('dialog[open][aria-label="Design my room"]'), 'original designer prompt');
    const before = localStorage.getItem(WORKSPACE_KEY)!;
    check(JSON.stringify(room(existing.id)) === JSON.stringify(existing), 'Opening the designer changed the starting layout');
    noModeLabels('original designer');
    pass('A normal saved room opens the original designer; legacy layout labels are migrated without a special entry point.');

    prompt('Please turn this into a purple spaceship with a library.'); await pause();
    await until(() => findButton('Find my room’s possibilities', dialog())?.disabled === false, 'room-design endpoint connected');
    await click('Find my room’s possibilities', dialog());
    await until(() => findButton('Cancel', dialog()), 'normal generation loading');
    check(cards().length === 0, 'Choices appeared before loading completed');
    await click('Cancel', dialog());
    await until(() => !findButton('Cancel', dialog()), 'cancelled progress removed');
    await pause(3_600);
    check(cards().length === 0, 'Cancelled generation later produced results');
    check(localStorage.getItem(WORKSPACE_KEY) === before, 'Cancelled generation saved or changed a layout');
    pass('Cancel stops loading and never applies a design, including after the server response window.');

    prompt('Anything at all: cobalt, zebras, and a reading corner.'); await pause();
    await click('Find my room’s possibilities', dialog());
    await until(() => cards().length === 3, 'three arrangements after loading');
    check(localStorage.getItem(WORKSPACE_KEY) === before, 'Generating choices saved a layout before selection');
    const options = cards();
    const names = options.map(option => option.querySelector('h3')?.textContent?.trim());
    check(names.every(Boolean) && new Set(names).size === 3, 'Options need three distinct names');
    check(options.every(option => pieces(option).length === 5), 'Every option must display five product pieces');
    const itemSets = options.map(option => JSON.stringify(pieces(option).map(piece => piece.getAttribute('aria-label')?.split(',')[0]).sort()));
    check(new Set(itemSets).size === 1, 'Options do not contain the same five products');
    check(new Set(options.map(geometry)).size === 3, 'Options do not have three distinct arrangements');
    const links = [...dialog().querySelectorAll<HTMLAnchorElement>('a[href*="amazon.com/dp/"]')];
    check(links.length === 5 && new Set(links.map(link => link.href)).size === 3, 'Expected five piece links to three unique Amazon listings');
    check(links.every(link => /^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}$/.test(link.href)), 'Invalid Amazon listing link');
    pass('An arbitrary prompt yields three distinct floor plans with the same five pieces and three Amazon links; nothing is applied yet.');
    noModeLabels('original results');

    const chosen = options[1], chosenName = names[1]!;
    const chosenIds = pieces(chosen).map(piece => piece.dataset.pieceId).sort();
    chosen.click(); await pause();
    check(chosen.getAttribute('aria-pressed') === 'true', 'Second option was not selected');
    check(localStorage.getItem(WORKSPACE_KEY) === before, 'Selecting a card applied it before confirmation');
    await click('Use this design', dialog());
    await until(() => !app.querySelector('dialog[open]') && app.querySelector<HTMLInputElement>('input[aria-label="Layout name"]')?.value.endsWith(chosenName), 'chosen arrangement in standard editor');
    await until(() => workspace().layouts.length === 3, 'only chosen arrangement saved');
    const selected = workspace().layouts.find(layout => layout.name.endsWith(chosenName));
    check(selected, 'Chosen layout was not saved');
    noModeMetadata(selected); noModeLabels('selected layout editor');
    check(selected.items.length === 5, 'Chosen layout does not contain five models');
    check(JSON.stringify(selected.items.map(item => item.id).sort()) === JSON.stringify(chosenIds), 'A different card was applied');
    const modelUrls = selected.items.map(item => item.product.variants.find(v => v.id === item.variantId)?.modelSrc);
    check(modelUrls.every(url => url?.startsWith('/models/urban-demo/') && url.endsWith('.glb')) && new Set(modelUrls).size === 5, 'Expected five local GLB model assets');
    check(selected.items.filter(item => item.product.placementKind === 'wall').every(item => (item.elevation ?? 0) > 1), 'Wall artwork lost its elevation');
    check(selected.survey?.walls.length && selected.survey.obstacles.length, 'Chosen layout lost the measured room or existing outlines');
    check(JSON.stringify(room(existing.id)) === JSON.stringify(existing), 'Choosing an arrangement changed the existing layout');
    const previousLayouts = (JSON.parse(before) as Workspace).layouts;
    check(previousLayouts.every(layout => JSON.stringify(room(layout.id)) === JSON.stringify(layout)), 'Choosing a design changed a previous layout');
    check(findButton('3D & AR')?.getAttribute('aria-pressed') === 'true', 'Selected layout did not open directly in 3D');
    await until(() => app.querySelector<ModelViewerElement>('model-viewer')?.loaded && findButton('View in AR')?.disabled === false, 'loaded 3D model and enabled AR action', 30_000);
    pass('Selecting option two saves exactly that arrangement, preserves previous layouts, and opens five local models in the regular 3D & AR editor.');

    await click('Floor plan');
    const piece = app.querySelector<SVGGElement>(`[data-piece-id="${selected.items[0].id}"]`);
    check(piece, 'Selected arrangement is not editable in the normal floor plan');
    piece.focus(); piece.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    await until(() => Math.abs(room(selected.id).items[0].x - selected.items[0].x + .05) < 1e-8, 'shared editor move');
    await click('Undo layout change');
    await until(() => JSON.stringify(room(selected.id).items) === JSON.stringify(selected.items), 'shared editor undo');
    await click('3D & AR');
    await until(() => app.querySelector<ModelViewerElement>('model-viewer')?.loaded && findButton('View in AR')?.disabled === false, '3D ready after normal editing', 30_000);
    pass('The chosen layout uses the standard move / Undo controls and returns to a ready 3D preview.');
    await click('Back to layouts');
    await until(() => findButton(`Open ${room(legacy.id).name}`), 'legacy layout card');
    noModeLabels('layout cards after migration');
    await click(`Open ${selected.name}`);
    await until(() => app.querySelector<ModelViewerElement>('model-viewer')?.loaded && findButton('View in AR')?.disabled === false, 'reopened chosen 3D layout', 30_000);
    noModeLabels('reopened 3D editor');
    pass('Existing layout cards and the reopened 3D editor contain no temporary mode labels.');
    check(blockedRequests.length === 0, `Unexpected API or external fetches were attempted (all blocked): ${blockedRequests.join(', ')}`);
    check(designRequests.filter(method => method === 'GET').length >= 1, 'Original designer never checked its server connection');
    check(designRequests.filter(method => method === 'POST').length === 2, 'Expected exactly two generation requests: cancelled and successful');
    pass(`Only the same-origin room-design endpoint was used (${designRequests.filter(method => method === 'GET').length} connection checks, 2 generation requests); no other browser API calls.`);
    report.dataset.status = 'passed';
    report.textContent = `${messages.join('\n')}\nALL DESIGNER WORKFLOW CHECKS PASSED\nSelected 3D layout remains open. Use Restore original workspace when finished.\nPhysical iPhone AR and server provider-call counts are not exercised by this browser fixture.`;
  } catch (error) {
    report.dataset.status = 'failed';
    report.textContent = `${messages.join('\n')}\nFAIL ${(error as Error).stack || String(error)}\nUse Restore original workspace when finished.`;
  } finally { running = false; restore.disabled = false; run.disabled = false; }
});
if (sessionStorage.getItem(SNAPSHOT_KEY)) report.textContent = 'A previous QA snapshot is available. Run again or restore your original workspace.';
