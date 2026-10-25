import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildProposal, DesignError, designPlacementValid, parseDesignRequest, scanOutline } from '../src/lib/design.ts';
import type { DesignCandidate, DesignRequest } from '../src/lib/design.ts';
import { createLayout, createProductItem, parseWorkspace, placeholderProduct, placeItem } from '../src/lib/workspace.ts';
import { parseRoomScan } from '../src/lib/room-scan.ts';
import { parseDesignResult } from '../src/lib/design-client.ts';
import { createClaudeClient } from '../server/claude.ts';
import { createDesignHandler } from '../server/design-handler.ts';
import { createDesignService } from '../server/design-service.ts';
import { suppliedDesignModel, designInventory } from '../server/design-catalog.ts';
import type { AmazonListing } from '../src/lib/amazon.ts';

const input = (): DesignRequest => ({ layout: createLayout('Living room', 'Living room', 5, 4), brief: 'A reading corner with room to work', style: 'Warm minimal', budget: 800, rules: {}, photos: [] });
const candidate = (id = 'amazon:B000000001', price = 100): DesignCandidate => ({ id, price, existing: false,
  item: { ...createProductItem('https://www.amazon.com/dp/B000000001', { ...placeholderProduct, dimensions: { width: .8, depth: .8, height: .8 } }), x: 0, z: 0, rotation: 0 } });
const draft = (items: { candidateId: string; x: number; z: number; rotation: number }[]) => ({ name: 'A quiet corner', description: 'A compact arrangement with an open center.', items });
const position = (id: string, x = 0, z = 0, rotation = 0) => ({ candidateId: id, x, z, rotation });
const request = (value: unknown, headers = {}, method = 'POST') => new Request('https://room.example/api/design/room', {
  method, headers: { 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(value) }),
});

test('design request rejects corrupt rooms, unsafe photos, and unbounded inputs', () => {
  const v = input(); assert.equal(parseDesignRequest(v).layout.name, v.layout.name);
  for (const patch of [{ budget: -1 }, { budget: Infinity }, { brief: '' }, { brief: 'x'.repeat(1601) }, { photos: [{ data: 'abcd', mediaType: 'image/jpeg' }] }, { photos: Array(5).fill({}) }]) {
    assert.throws(() => parseDesignRequest({ ...v, ...patch }));
  }
  const broken = placeItem(v.layout, candidate().item);
  broken.items[0].x = 100;
  assert.throws(() => parseDesignRequest({ ...v, layout: broken }), /outside/);
  assert.throws(() => parseDesignRequest({ ...v, layout: { ...v.layout, items: [{}] } }));
  const tiny = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGZkAAAAASUVORK5CYII=';
  assert.equal(parseDesignRequest({ ...v, photos: [{ mediaType: 'image/png', data: tiny }] }).photos.length, 1);
});
test('new purchases use server prices, count repeated units, and reject invented candidates', () => {
  const v = input(), c = candidate();
  const result = buildProposal(draft([position(c.id, -1), position(c.id, 1)]), v, [c]);
  assert.equal(result.total, 200); assert.equal(result.added, 2);
  assert.notEqual(result.layout.items[0].id, result.layout.items[1].id);
  assert.throws(() => buildProposal(draft([position('invented')]), v, [c]));
  assert.throws(() => buildProposal(draft([position(c.id)]), { ...v, budget: 99.99 }, [c]), /exceed/);
  assert.throws(() => buildProposal(draft([position(c.id)]), v, [{ ...c, price: null }]), /price/);
});
test('generated rotations use the editor’s 15-degree increments', () => {
  const c = candidate(), result = buildProposal(draft([position(c.id, 0, 0, 37)]), input(), [c]);
  assert.equal(result.layout.items[0].rotation, 30);
});
test('locks override model coordinates, kept pieces cannot disappear, and the original is unchanged', () => {
  const v = input(); v.layout = placeItem(v.layout, candidate().item);
  const original = structuredClone(v.layout), item = v.layout.items[0];
  v.rules[item.id] = 'fixed'; const kept = { id: `existing:${item.id}`, item, price: 0, existing: true };
  const result = buildProposal(draft([position(kept.id, 200, 200, 90)]), v, [kept]);
  assert.deepEqual(result.layout.items[0], item); assert.equal(result.total, 0);
  assert.deepEqual(v.layout, original); assert.notEqual(result.layout.id, v.layout.id);
  assert.throws(() => buildProposal(draft([position(candidate().id)]), v, [kept, candidate()]), /left out/);
  assert.throws(() => buildProposal(draft([position(kept.id), position(kept.id)]), v, [kept]), /preserved/);
  v.rules[item.id] = 'remove'; assert.throws(() => buildProposal(draft([position(kept.id)]), v, [kept]));
});
test('colliding placements are repaired; impossible products are rejected instead of clamped or omitted', () => {
  const v = input(), c = candidate();
  const result = buildProposal(draft([position(c.id), position(c.id)]), v, [c]);
  assert.ok(result.notes.some(n => n.includes('adjusted')));
  assert.ok(result.layout.items.every(i => designPlacementValid(i, result.layout)));
  const huge = { ...c, item: { ...c.item, product: { ...c.item.product, dimensions: { width: 10, depth: 10, height: 2 } } } };
  assert.throws(() => buildProposal(draft([position(c.id)]), v, [huge]), /cannot fit/);
});
test('scanned obstacles and doorway clearance are respected without displaying guessed labels', () => {
  const scan = parseRoomScan(JSON.parse(readFileSync(new URL('./fixtures/room-scan.json', import.meta.url), 'utf8')));
  const v = input(); v.layout = { ...v.layout, width: scan.width, depth: scan.depth, survey: scan.survey };
  const c = candidate(), result = buildProposal(draft([position(c.id, -1.1, -1.35)]), v, [c]);
  assert.ok(result.layout.items.every(i => designPlacementValid(i, result.layout)));
  assert.deepEqual(result.layout.survey, scan.survey);
});
test('concave scanned rooms exclude the missing corner and disconnected outlines fail closed', () => {
  const v = input();
  const points = [{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 2 }, { x: -2, z: 2 }];
  v.layout = { ...v.layout, width: 4, depth: 4, survey: { source: 'apple-roomplan', capturedAt: new Date().toISOString(), openings: [], obstacles: [],
    walls: points.map((p, i) => ({ id: `wall-${i}`, start: p, end: points[(i + 1) % points.length], height: 2.5, confidence: 'high' })) } };
  assert.equal(scanOutline(v.layout)?.length, 6);
  const c = candidate(); assert.equal(designPlacementValid({ ...c.item, x: 1, z: 1 }, v.layout), false);
  const result = buildProposal(draft([position(c.id, 1, 1)]), v, [c]);
  assert.ok(designPlacementValid(result.layout.items[0], result.layout));
  v.layout.survey!.walls.pop();
  assert.throws(() => buildProposal(draft([position(c.id)]), v, [c]), /closed/);
});
test('proposals round-trip through browser persistence and the client validates the contract', () => {
  const c = candidate(), p = buildProposal(draft([position(c.id)]), input(), [c]);
  const result = parseDesignResult({ summary: 'A quiet room', observations: [], proposals: [p], notices: [] });
  assert.equal(result.proposals[0].layout.items.length, 1);
  assert.equal(parseWorkspace(JSON.parse(JSON.stringify({ layouts: [p.layout] }))).layouts[0].items.length, 1);
  assert.throws(() => parseDesignResult({ summary: 'x', observations: [], proposals: [{ ...p, total: -1 }], notices: [] }));
});
test('Claude receives bounded images and structured output with the configured Opus ID', async () => {
  let sent: Record<string, any> = {};
  const client = createClaudeClient(async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal((options!.headers as Record<string, string>)['x-api-key'], 'test-secret');
    sent = JSON.parse(options!.body as string);
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }] });
  });
  assert.deepEqual(await client({ system: 'Be precise', prompt: 'Read this room', schema: { type: 'object' }, photos: [{ mediaType: 'image/png', data: 'aGVsbG8=' }] }, { ANTHROPIC_API_KEY: 'test-secret', CLAUDE_MODEL: 'claude-opus-4-6' }), { ok: true });
  assert.equal(sent.model, 'claude-opus-4-6'); assert.equal(sent.output_config.format.type, 'json_schema');
  assert.equal(sent.messages[0].content[1].source.type, 'base64'); assert.ok(!JSON.stringify(sent).includes('test-secret'));
});
test('Claude provider errors and truncated output never expose provider messages or secrets', async () => {
  for (const response of [Response.json({ error: { message: 'secret-key-value' } }, { status: 401 }), Response.json({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'secret-key-value' }] })]) {
    const client = createClaudeClient(async () => response);
    await assert.rejects(client({ system: '', prompt: '', schema: {} }, { ANTHROPIC_API_KEY: 'test-secret' }), e => e instanceof Error && !e.message.includes('secret'));
  }
});
test('Claude rejects redirects without forwarding credentials and uses a Workers-supported mode', async () => {
  let calls = 0;
  const client = createClaudeClient(async (_url, options) => {
    calls++;
    // Cloudflare Workers throws before making a request for redirect: 'error'.
    if (options?.redirect === 'error') throw new TypeError('Unsupported redirect mode');
    assert.equal(options?.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://unexpected.example/messages' } });
  });
  await assert.rejects(client({ system: '', prompt: '', schema: {} }, { ANTHROPIC_API_KEY: 'test-secret' }),
    (error: unknown) => error instanceof DesignError && error.code === 'DESIGN_UNAVAILABLE');
  assert.equal(calls, 1);
});
test('no API key yields an honest status and never starts a design call', async () => {
  let called = false; const handle = createDesignHandler({ design: async () => { called = true; throw Error('should not run'); } });
  assert.deepEqual(await (await handle(request(null, {}, 'GET'))).json(), { configured: false, shopping: false });
  const response = await handle(request(input())); assert.equal(response.status, 503); assert.equal(called, false);
});
test('design endpoint rejects cross-origin, non-JSON, huge, and corrupt requests before AI', async () => {
  let calls = 0; const handler = createDesignHandler({ design: async () => { calls++; throw new Error('unused'); } });
  const env = { ANTHROPIC_API_KEY: 'test' };
  assert.equal((await handler(request(input(), { Origin: 'https://evil.example' }), env)).status, 403);
  assert.equal((await handler(request(input(), { 'Content-Type': 'text/plain' }), env)).status, 415);
  assert.equal((await handler(request(input(), { 'Content-Length': '6000000' }), env)).status, 413);
  assert.equal((await handler(request({ brief: 'no layout' }), env)).status, 400);
  assert.equal(calls, 0);
});
test('complete service uses retrieved products, repairs invalid AI output once, and returns editable proposals', async () => {
  const v = input(), model = candidate().item.product; let calls = 0;
  const listing: AmazonListing = { asin: 'B000000001', title: 'A real table', brand: null, url: 'https://www.amazon.com/dp/B000000001', images: [], price: { amount: 125, currency: 'USD', display: '$125' }, availability: null, features: [], dimensionText: null, dimensions: model.dimensions, retrievedAt: new Date().toISOString(), modelNote: 'Approximate' };
  const service = createDesignService({ search: async () => ({ products: [{ asin: listing.asin, modelAvailable: true }] }),
    lookup: async () => ({ listing, product: { ...model, variants: model.variants.slice(0, 1).map(p => ({ ...p, asin: listing.asin, productUrl: listing.url })) } }),
    claude: async ({ prompt }) => {
      calls++;
      if (calls === 1) return { summary: 'A place to read', observations: [], searches: ['small table'], catalogAsins: [] };
      if (calls === 2) return { proposals: [draft([position('made-up')])] };
      assert.match(prompt, /failed application checks/);
      return { proposals: [draft([position(`amazon:${listing.asin}`)])] };
    },
  });
  const result = await service(v, { ANTHROPIC_API_KEY: 'test', SERPAPI_API_KEY: 'test' });
  assert.equal(calls, 3); assert.equal(result.proposals[0].total, 125); assert.equal(result.proposals[0].layout.items[0].listing?.asin, listing.asin);
  assert.ok(result.notices.some(n => n.includes('One design passed')));
});
test('zero-budget design does not make shopping requests and keeps all existing pieces', async () => {
  const v = input(); v.budget = 0; v.layout = placeItem(v.layout, candidate().item);
  const item = v.layout.items[0]; v.rules[item.id] = 'move'; let calls = 0;
  const service = createDesignService({ search: async () => { throw new Error('must not search'); },
    claude: async () => ++calls === 1 ? { summary: 'Rearranged', observations: [], searches: [], catalogAsins: [] }
      : { proposals: [draft([position(`existing:${item.id}`, 1, 1)])] },
  });
  const result = await service(v, { ANTHROPIC_API_KEY: 'test', SERPAPI_API_KEY: 'test' });
  assert.equal(result.proposals[0].total, 0); assert.equal(result.proposals[0].layout.items[0].x, 1);
});
test('occupied room service preserves the full survey and gives Claude anonymous fixed geometry', async () => {
  const scan = parseRoomScan(JSON.parse(readFileSync(new URL('./fixtures/room-scan.json', import.meta.url), 'utf8')));
  const v = input();
  v.budget = 0;
  v.layout = placeItem({ ...v.layout, width: scan.width, depth: scan.depth, survey: scan.survey }, candidate().item);
  const item = v.layout.items[0]; v.rules[item.id] = 'move';
  const original = structuredClone(v.layout); let calls = 0;
  const service = createDesignService({ claude: async ({ prompt }) => {
    calls++;
    if (calls === 1) {
      const sent = JSON.parse(prompt.split('BRIEF: ')[1].split('\nSUPPLIED PROTOTYPE INVENTORY:')[0]);
      assert.equal(sent.room.geometrySource, 'apple-roomplan');
      assert.equal(sent.room.obstacles.length, 3);
      assert.deepEqual(sent.room.walls, scan.survey.walls);
      assert.deepEqual(sent.room.openings, scan.survey.openings);
      for (const obstacle of sent.room.obstacles) {
        assert.equal(obstacle.identity, 'unknown; fixed obstacle');
        assert.equal(obstacle.name, undefined); assert.equal(obstacle.category, undefined);
      }
      return { summary: 'Work around what is already here.', observations: [], searches: [], catalogAsins: [] };
    }
    // Even a model placement inside existing furniture must be repaired safely.
    const occupied = scan.survey.obstacles[0];
    return { proposals: [draft([position(`existing:${item.id}`, occupied.x, occupied.z)])] };
  } });
  const result = await service(v, { ANTHROPIC_API_KEY: 'test' });
  assert.deepEqual(v.layout, original);
  assert.deepEqual(result.proposals[0].layout.survey, original.survey);
  assert.ok(result.proposals[0].layout.items.every(i => designPlacementValid(i, result.proposals[0].layout)));
  assert.equal(result.proposals[0].total, 0);
});
test('supplied inventory requires exact ASIN, matching title and non-conflicting dimensions', () => {
  const entry = designInventory[0];
  const listing = { asin: entry.asin, title: entry.name, dimensions: entry.dimensions, url: `https://www.amazon.com/dp/${entry.asin}`, brand: null } as AmazonListing;
  assert.ok(suppliedDesignModel(listing));
  assert.equal(suppliedDesignModel({ ...listing, title: 'Unrelated product' }), null);
  assert.equal(suppliedDesignModel({ ...listing, dimensions: { ...entry.dimensions, width: 10 } }), null);
  assert.equal(suppliedDesignModel({ ...listing, asin: 'B000000000' }), null);
});

test('design lookups stay within the importer concurrency limit and retain later search candidates', async () => {
  const asins = ['B000000001', 'B000000002', 'B000000003', 'B000000004'];
  const inventoryAsins = designInventory.slice(0, 4).map(p => p.asin);
  let active = 0, peak = 0, calls = 0; const loaded: string[] = [];
  const product = candidate().item.product;
  const service = createDesignService({
    claude: async () => ++calls === 1
      ? { summary: 'A reading corner', observations: [], searches: ['chair', 'table'], catalogAsins: inventoryAsins }
      : { proposals: [draft([position(`amazon:${asins[3]}`)])] },
    search: async ({ q }) => ({ products: (q === 'chair' ? asins.slice(0, 2) : asins.slice(2)).map(asin => ({ asin, modelAvailable: true })) }),
    lookup: async asin => {
      active++; peak = Math.max(peak, active); loaded.push(asin);
      try {
        assert.ok(active <= 4);
        await new Promise(resolve => setImmediate(resolve));
        const url = `https://www.amazon.com/dp/${asin}`;
        return { listing: { asin, title: 'Retrieved table', url, brand: null, images: [], price: { amount: 100, currency: 'USD', display: '$100' }, availability: null, features: [], dimensionText: null, dimensions: product.dimensions, retrievedAt: new Date().toISOString(), modelNote: 'Approximate' },
          product: { ...product, variants: product.variants.slice(0, 1).map(v => ({ ...v, asin, productUrl: url })) } };
      } finally { active--; }
    },
  });
  const result = await service(input(), { ANTHROPIC_API_KEY: 'test', SERPAPI_API_KEY: 'test' });
  assert.equal(peak, 4); assert.equal(loaded.length, 8);
  assert.equal(result.proposals[0].layout.items[0].listing?.asin, asins[3]);
});
