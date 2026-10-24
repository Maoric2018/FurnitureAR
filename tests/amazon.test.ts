import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeImport, parseAmazonLink } from '../server/amazon-import.js';
import { createImportHandler } from '../server/import-handler.js';
import { SerpApiClient } from '../server/partner/serpapi.js';
import { normalizeSerpProduct } from '../server/partner/serp-normalize.js';
import { parseListing } from '../src/lib/amazon.ts';
import { createImportedItem, createLayout, parseWorkspace, placeItem } from '../src/lib/workspace.ts';

const table = { product_results: { asin: 'B0F2ML48Y6', title: 'Oak dining table', price: '$176.99', extracted_price: 176.99, thumbnails: ['https://m.media-amazon.com/images/table.jpg'] }, product_details: { asin: 'B0F2ML48Y6', product_dimensions: '47.24"D x 47.24"W x 29.53"H' }, about_item: ['Round oak table'] };
const request = (url = 'https://www.amazon.com/dp/B0F2ML48Y6', user = 'test-user') => new Request('https://furniture.example/api/products/import', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://furniture.example', ...(user ? { 'oai-authenticated-user-id': user } : {}) }, body: JSON.stringify({ url }) });

test('Transport preserves the global fetch receiver required by Workers', async () => {
  const client = new SerpApiClient({ serpApiKey: 'test-key', serpTimeoutMs: 1000 }, { fetchImpl: function(this: unknown) {
    assert.equal(this, globalThis);
    return Promise.resolve(Response.json(table));
  } });
  assert.equal((await client.get('B0F2ML48Y6')).product_results.asin, 'B0F2ML48Y6');
});
test('Worker transport never follows a credential-bearing provider redirect', async () => {
  let calls = 0;
  const client = new SerpApiClient({ serpApiKey: 'test-key', serpTimeoutMs: 1000 }, { fetchImpl: async (_url: unknown, init: RequestInit) => {
    calls++; assert.equal(init.redirect, 'manual');
    return new Response('', { status: 302, headers: { Location: 'https://unrelated.example' } });
  } });
  await assert.rejects(client.get('B0F2ML48Y6'), /could not complete/);
  assert.equal(calls, 1);
});

test('Amazon links and bare ASINs normalize without fetching arbitrary URLs', () => {
  for (const url of ['B0F2ML48Y6', 'amazon.com/name/dp/B0F2ML48Y6?tag=anything', 'https://www.amazon.com/gp/product/b0f2ml48y6/ref=abc', 'https://m.amazon.com/gp/aw/d/B0F2ML48Y6']) assert.equal(parseAmazonLink(url), 'B0F2ML48Y6');
  for (const url of ['https://example.com/dp/B0F2ML48Y6', 'https://amazon.com.evil.com/dp/B0F2ML48Y6', 'https://amazon.com@evil.com/dp/B0F2ML48Y6', 'https://amazon.com:444/dp/B0F2ML48Y6', 'https://www.amazon.com/s?k=chair', 'https://a.co/short', 'http://amazon.com/dp/B0F2ML48Y6', 'https://amazon.co.uk/dp/B0F2ML48Y6']) assert.throws(() => parseAmazonLink(url));
});
test('Matching models keep geometry dimensions separate from listing measurements', () => {
  const result = normalizeImport(table, 'B0F2ML48Y6');
  assert.equal(parseListing(result.listing).price?.amount, 176.99);
  assert.equal(result.product?.variants[0].modelSrc, '/models/little-tree-oak-table.glb');
  assert.equal(result.product?.dimensions.height, .750062);
  const lamp = normalizeImport({ product_results: { asin: 'B0C4DGFFCM', title: 'Floor lamp' }, product_details: { product_dimensions: '11"D x 11"W x 61.8"H' } }, 'B0C4DGFFCM');
  assert.equal(lamp.product?.dimensions.height, 1.524);
  assert.ok(Math.abs(lamp.listing.dimensions!.height! - 1.56972) < .000001);
  assert.match(lamp.listing.modelNote!, /different height/);
});
test('Integrated imports expose observed table colors with exact variant links and independent material overrides', () => {
  const result = normalizeImport({ ...table, product_results: { ...table.product_results,
    variants: [{ title: 'Color', items: [
      { name: 'Oak', asin: 'B0F2ML48Y6', selected: true },
      { name: 'Black', asin: 'B0D8P23H61', selected: false },
      { name: 'White', asin: 'B0DSZGP1HK', selected: false },
      { name: 'Blue', asin: 'B012345678', selected: false },
    ] }],
  } }, 'B0F2ML48Y6');
  assert.deepEqual(result.product?.variants.map(variant => variant.name), ['Oak', 'Black', 'White']);
  assert.equal(result.product?.variants[1].productUrl, 'https://www.amazon.com/dp/B0D8P23H61');
  assert.equal(result.product?.variants[1].approximate, true);
  assert.deepEqual(result.product?.variants[1].materialOverrides, [{ materialName: 'Oak | original grain texture', color: '#292929' }]);
  assert.equal(result.product?.dimensions.height, .750062);
  const stored = createImportedItem(parseListing(result.listing), result.product);
  stored.variantId = 'B0DSZGP1HK';
  assert.equal(parseWorkspace({ items: [stored], layouts: [] }).items[0].variantId, 'B0DSZGP1HK');
});
test('Missing or ambiguous live color groups keep only the requested mapped finish', () => {
  assert.equal(normalizeImport(table, 'B0F2ML48Y6').product?.variants.length, 1);
  const black = normalizeImport({ product_results: { asin: 'B0D8P23H61', title: 'Black table',
    variants: [{ title: 'Color', items: [{ name: 'Oak', asin: 'B0D8P23H61', selected: true }] }],
  } }, 'B0D8P23H61');
  assert.deepEqual(black.product?.variants.map(variant => variant.name), ['Black']);
  assert.equal(black.product?.variants[0].asin, 'B0D8P23H61');
  assert.equal(black.product?.variants[0].approximate, true);
});
test('Matching unlabeled duplicates do not erase explicitly labeled dimensions', () => {
  const data = { product_details: { product_dimensions: '47.24 x 47.24 x 29.53 inches' }, item_specifications: { item_dimensions: '47.24"D x 47.24"W x 29.53"H' } };
  assert.equal(normalizeSerpProduct(data, 'B0F2ML48Y6').dimensions.complete, true);
  assert.equal(normalizeSerpProduct({ product_details: data.product_details }, 'B0F2ML48Y6').dimensions, null);
  assert.equal(normalizeSerpProduct({ ...data, product_details: { product_dimensions: '47.24 x 47.24 x 35 inches' } }, 'B0F2ML48Y6').dimensions, null);
});
test('Unknown products save and reopen without a fake model and cannot enter layouts', () => {
  const result = normalizeImport({ product_results: { asin: 'B012345678', title: 'Another chair' } }, 'B012345678');
  assert.equal(result.product, null);
  assert.equal(result.listing.dimensions, null);
  const item = createImportedItem(parseListing(result.listing), null);
  assert.deepEqual(parseWorkspace(JSON.parse(JSON.stringify({ items: [item], layouts: [] }))).items, [item]);
  assert.throws(() => placeItem(createLayout('Room'), item), /matching 3D model/);
});
test('An upstream variant mismatch never receives a registered model', () => {
  assert.throws(() => normalizeImport({ ...table, product_details: { asin: 'B012345678' } }, 'B0F2ML48Y6'), /different product variant/);
  assert.throws(() => normalizeImport({ product_results: { title: 'No confirmed ID' } }, 'B0F2ML48Y6'), /different product variant/);
});
test('Importer requires sign-in and same-origin JSON before using provider allowance', async () => {
  let calls = 0;
  const handler = createImportHandler({ lookup: async () => { calls++; return normalizeImport(table, 'B0F2ML48Y6'); } });
  assert.equal((await handler(request(undefined, ''))).status, 401);
  const cross = request(); cross.headers.set('Origin', 'https://evil.example'); assert.equal((await handler(cross)).status, 403);
  const invalid = request('https://localhost/secret'); assert.equal((await handler(invalid)).status, 400);
  assert.equal(calls, 0);
});
test('Repeated and concurrent imports share a lookup, then expire after one hour', async () => {
  let calls = 0, clock = 1000;
  const handler = createImportHandler({ lookup: async () => { calls++; return normalizeImport(table, 'B0F2ML48Y6'); }, now: () => clock });
  const responses = await Promise.all([handler(request()), handler(request())]);
  assert.ok(responses.every(r => r.status === 200)); assert.equal(calls, 1);
  assert.equal((await (await handler(request())).json()).cached, true); assert.equal(calls, 1);
  clock += 3600001; await handler(request()); assert.equal(calls, 2);
});
test('Quota and network failures stay useful without leaking the API key', async () => {
  const client = new SerpApiClient({ serpApiKey: 'SECRET_TEST_VALUE', serpTimeoutMs: 1000 }, { fetchImpl: async () => { throw new Error('https://provider.invalid?api_key=SECRET_TEST_VALUE'); } });
  const handler = createImportHandler({ lookup: asin => client.get(asin) });
  const response = await handler(request()); const body = await response.text();
  assert.equal(response.status, 502); assert.match(body, /SERPAPI_UNAVAILABLE/); assert.ok(!body.includes('SECRET_TEST_VALUE'));
});
test('Persisted listing validation rejects unsafe images and incomplete dimensions', () => {
  const listing = normalizeImport(table, 'B0F2ML48Y6').listing;
  assert.throws(() => parseListing({ ...listing, images: ['javascript:alert(1)'] }));
  assert.throws(() => parseListing({ ...listing, images: ['https://example.com/photo?api_key=secret'] }));
  assert.throws(() => parseListing({ ...listing, dimensions: { height: 1 } }));
});
test('Lamp GLB remains embedded and floor-centered after placement preparation', async () => {
  const bytes = await readFile(new URL('../public/models/ambimall-floor-lamp.glb', import.meta.url));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const root = doc.nodes[doc.scenes[doc.scene || 0].nodes[0]];
  assert.equal(root.name, 'Floor centered for room layouts');
  assert.ok(root.children.length); assert.equal(root.translation[1], 0);
  assert.ok(doc.images.every((image: { uri?: string }) => !image.uri || image.uri.startsWith('data:')));
});
