import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import { adaptAmazonProduct, createAmazonImportMiddleware } from '../server/amazon-import.ts';

const oak = 'B0F2ML48Y6', black = 'B0D8P23H61', white = 'B0DSZGP1HK';
function fixture(asin = oak) {
  const colors = [{ label: 'Oak', asin: oak }, { label: 'Black', asin: black }, { label: 'White', asin: white }];
  return {
    source: 'serpapi', product: {
      asin, title: 'LITTLE TREE 47.24 inch round dining table',
      selectedColor: colors.find(color => color.asin === asin)?.label,
      dimensions: { meters: { width: 1.2, height: .75, length: 1.2 }, complete: true },
      variantGroups: [{ title: 'Color', kind: 'color', options: colors.map(color => ({ ...color,
        productUrl: `https://www.amazon.com/dp/${color.asin}`, selected: color.asin === asin })) }],
      variantCombinations: [] as { dimensions: Record<string, string>; asin: string; unavailable: boolean | null }[],
    },
  };
}

test('The adapter returns only observed known colors and starts with the fetched selection', () => {
  const product = adaptAmazonProduct(fixture(black), black);
  assert.equal(product.id, black);
  assert.equal(product.name, 'LITTLE TREE 47.24 inch round dining table');
  assert.equal(product.material, 'Black');
  assert.equal(product.category, 'Tables');
  assert.deepEqual(product.dimensions, { width: 1.2, height: .75, depth: 1.2 });
  assert.deepEqual(product.variants.map(variant => variant.name), ['Black', 'Oak', 'White']);
  assert.deepEqual(product.variants.map(variant => variant.asin), [black, oak, white]);
  assert.equal(product.variants[0].color, '#292929');
  assert.equal(product.variants[0].approximate, true);
  assert.equal(product.variants[0].productUrl, `https://www.amazon.com/dp/${black}`);
  assert.deepEqual(product.variants[0].materialOverrides, [{ materialName: 'Oak | original grain texture', color: '#292929' }]);
  assert.equal(product.variants[1].materialOverrides, undefined);
  assert.match(product.description, /approximate/);
  assert.match(product.description, /existing oak wood table model/);
});

test('The adapter requires matching ASINs, complete meter dimensions, and known geometry', () => {
  assert.throws(() => adaptAmazonProduct(fixture(), black), /different product/);
  assert.throws(() => adaptAmazonProduct(fixture('B000DEMO01'), 'B000DEMO01'), /3D model is not available/);
  for (const dimensions of [undefined, {}, { complete: false, meters: { width: 1.2, height: .75, length: 1.2 } },
    { complete: true, meters: { width: 1.2, height: .75 } },
    { complete: true, meters: { width: 0, height: .75, length: 1.2 } },
    { complete: true, meters: { width: 1.2, height: NaN, length: 1.2 } },
    { complete: true, meters: { width: 120, height: 75, length: 120 } }]) {
    const raw = fixture();
    assert.throws(() => adaptAmazonProduct({ ...raw, product: { ...raw.product, dimensions } }, oak), /measurements in meters/);
  }
  const raw = fixture();
  assert.throws(() => adaptAmazonProduct({ ...raw, product: { ...raw.product, variantGroups: [] } }, oak), /color options/);
});

test('Combinations retain the current size and style and exclude unavailable colors', () => {
  const raw = fixture();
  raw.product.variantCombinations = [
    { asin: oak, dimensions: { color: 'Oak', size: '47.24 inches', style: 'Round' }, unavailable: null },
    { asin: black, dimensions: { color: 'Black', size: '47.24 inches', style: 'Round' }, unavailable: false },
    { asin: white, dimensions: { color: 'White', size: '47.24 inches', style: 'Round' }, unavailable: true },
    { asin: 'B000DEMO01', dimensions: { color: 'Black', size: '60 inches', style: 'Round' }, unavailable: false },
  ];
  // A direct swatch can point at another size; the complete current-size combination controls selection.
  raw.product.variantGroups[0].options[1].asin = 'B000DEMO01';
  raw.product.variantGroups[0].options[1].productUrl = 'https://www.amazon.com/dp/B000DEMO01';
  const product = adaptAmazonProduct(raw, oak);
  assert.deepEqual(product.variants.map(variant => variant.asin), [oak, black]);
  assert.equal(product.variants[1].productUrl, `https://www.amazon.com/dp/${black}`);
  raw.product.variantCombinations[1].dimensions.style = 'Square';
  assert.deepEqual(adaptAmazonProduct(raw, oak).variants.map(variant => variant.asin), [oak]);
});

test('The adapter does not invent missing colors or use unknown-family option geometry', () => {
  const raw = fixture();
  raw.product.variantGroups[0].options = [raw.product.variantGroups[0].options[0],
    { label: 'Blue', asin: 'B000DEMO01', productUrl: 'https://www.amazon.com/dp/B000DEMO01', selected: false }];
  assert.deepEqual(adaptAmazonProduct(raw, oak).variants.map(variant => variant.name), ['Oak']);
});

test('Ambiguous labels, ASINs, selections, links, and combinations are rejected', () => {
  const duplicateLabel = fixture();
  duplicateLabel.product.variantGroups[0].options[1].label = 'Oak';
  assert.throws(() => adaptAmazonProduct(duplicateLabel, oak), /duplicate|inconsistent/);
  const duplicateAsin = fixture();
  duplicateAsin.product.variantGroups[0].options[1].asin = oak;
  assert.throws(() => adaptAmazonProduct(duplicateAsin, oak), /duplicate/);
  const wrongLabel = fixture();
  wrongLabel.product.variantGroups[0].options[1].label = 'Brown';
  assert.throws(() => adaptAmazonProduct(wrongLabel, oak), /inconsistent color/);
  const wrongSelected = fixture();
  wrongSelected.product.variantGroups[0].options[1].selected = true;
  assert.throws(() => adaptAmazonProduct(wrongSelected, oak), /selected color/);
  const wrongLink = fixture();
  wrongLink.product.variantGroups[0].options[1].productUrl = 'https://private.example/credential';
  assert.throws(() => adaptAmazonProduct(wrongLink, oak), /inconsistent color links/);
  const duplicateCombinations = fixture();
  duplicateCombinations.product.variantCombinations = [
    { asin: oak, dimensions: { color: 'Oak', size: '47.24 inches' }, unavailable: false },
    { asin: black, dimensions: { color: 'Black', size: '47.24 inches' }, unavailable: false },
    { asin: 'B000DEMO01', dimensions: { color: 'Black', size: '47.24 inches' }, unavailable: false },
  ];
  assert.throws(() => adaptAmazonProduct(duplicateCombinations, oak), /ambiguous color and size/);
  const wrongCurrent = fixture();
  wrongCurrent.product.variantCombinations = [{ asin: black, dimensions: { color: 'Black', size: '47.24 inches' }, unavailable: false }];
  assert.throws(() => adaptAmazonProduct(wrongCurrent, oak), /identify an available color and size/);
});

type Middleware = ReturnType<typeof createAmazonImportMiddleware>;
async function invoke(middleware: Middleware, body: string, options: { url?: string; method?: string; contentLength?: number; chunks?: string[] } = {}) {
  const stream = new PassThrough();
  const request = Object.assign(stream, { url: options.url ?? '/api/products/import', method: options.method ?? 'POST',
    headers: options.contentLength === undefined ? {} : { 'content-length': String(options.contentLength) } }) as unknown as IncomingMessage;
  const headers: Record<string, unknown> = {};
  let responseBody = '', nextCalls = 0;
  const response = { statusCode: 200, destroyed: false, writableEnded: false,
    setHeader(name: string, value: unknown) { headers[name] = value; },
    end(value: string) { responseBody = value; this.writableEnded = true; },
  };
  const running = middleware(request, response as unknown as ServerResponse, () => { nextCalls++; });
  if (options.chunks) for (const chunk of options.chunks) stream.write(chunk);
  stream.end(options.chunks ? undefined : body);
  await running;
  return { status: response.statusCode, headers, text: responseBody, body: responseBody ? JSON.parse(responseBody) : undefined, nextCalls };
}
function middleware(fetchImpl: typeof fetch, authToken?: string) {
  return createAmazonImportMiddleware({ backendBaseUrl: 'https://trusted-backend.example/internal', fetchImpl, authToken });
}

test('Middleware fetches only the configured backend, with private auth and no redirects', async () => {
  let count = 0;
  const handler = middleware(async (url, options) => {
    count++;
    assert.equal(url, `https://trusted-backend.example/internal/v1/products/${oak}`);
    assert.equal(options?.method, 'GET');
    assert.equal(options?.redirect, 'error');
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer private-test-token');
    assert.ok(options?.signal instanceof AbortSignal);
    return Response.json(fixture());
  }, 'private-test-token');
  for (const path of [`dp/${oak}`, `gp/product/${oak}`, `gp/aw/d/${oak}`,
    `LITTLE-TREE-Dining-Pedestal-Kitchen/dp/${oak}`, `dp/${oak}/ref=sr_1_5`,
    `LITTLE-TREE-Dining-Pedestal-Kitchen/dp/${oak}/ref=sr_1_5`]) {
    const result = await invoke(handler, JSON.stringify({ url: `https://www.amazon.com/${path}?tracking=unused` }));
    assert.equal(result.status, 200);
    assert.equal(result.body.product.id, oak);
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.doesNotMatch(result.text, /private-test-token|trusted-backend/);
  }
  assert.equal(count, 6);
});

test('Middleware rejects arbitrary URLs, lookalikes, short links, unsafe protocols and malformed requests without fetch', async () => {
  let count = 0;
  const handler = middleware(async () => { count++; return Response.json(fixture()); });
  for (const url of [
    'https://private.example/dp/B0F2ML48Y6', 'https://amazon.com.evil.example/dp/B0F2ML48Y6',
    'https://a.co/d/abc', 'https://amzn.to/abc', 'http://amazon.com/dp/B0F2ML48Y6',
    'https://www.amazon.co.uk/dp/B0F2ML48Y6', 'https://user:secret@amazon.com/dp/B0F2ML48Y6',
    'https://amazon.com:444/dp/B0F2ML48Y6', 'https://www.amazon.com/dp/B0F2ML48Y6/unrecognized-path',
    'https://www.amazon.com/', 'file:///etc/passwd', 'javascript:alert(1)',
  ]) assert.equal((await invoke(handler, JSON.stringify({ url }))).status, 400, url);
  for (const body of ['{', 'null', '[]', '{}', '{"url":42}']) assert.equal((await invoke(handler, body)).status, 400);
  const unsupported = await invoke(handler, JSON.stringify({ url: 'https://www.amazon.com/dp/B000DEMO01' }));
  assert.equal(unsupported.status, 422);
  assert.match(unsupported.body.error, /3D model is not available/);
  assert.equal(count, 0);
  assert.equal((await invoke(handler, '', { method: 'GET' })).status, 405);
  assert.equal((await invoke(handler, '', { url: '/unrelated' })).nextCalls, 1);
});

test('Returned Amazon option links are canonicalized and never retain referral or query data', () => {
  const raw = fixture();
  raw.product.variantGroups[0].options[0].productUrl = `https://www.amazon.com/LITTLE-TREE-Dining-Pedestal-Kitchen/dp/${oak}/ref=sr_1_5?tracking=unused`;
  const product = adaptAmazonProduct(raw, oak);
  assert.equal(product.variants[0].productUrl, `https://www.amazon.com/dp/${oak}`);
});

test('Middleware bounds both declared and streamed request and response sizes', async () => {
  let count = 0;
  const handler = middleware(async () => { count++; return Response.json(fixture()); });
  assert.equal((await invoke(handler, '{}', { contentLength: 4097 })).status, 413);
  assert.equal((await invoke(handler, '', { chunks: [' '.repeat(2048), ' '.repeat(2049)] })).status, 413);
  assert.equal(count, 0);
  const body = JSON.stringify({ url: `https://www.amazon.com/dp/${oak}` });
  const declared = middleware(async () => new Response('{}', { headers: { 'content-length': String(5 * 1024 * 1024 + 1) } }));
  assert.equal((await invoke(declared, body)).status, 502);
  const streamed = middleware(async () => new Response(' '.repeat(5 * 1024 * 1024 + 1)));
  assert.equal((await invoke(streamed, body)).status, 502);
});

test('Middleware reports safe backend, parsing, timeout and configuration errors without credentials', async () => {
  const body = JSON.stringify({ url: `https://www.amazon.com/dp/${oak}` });
  for (const status of [401, 403, 404, 429, 500]) {
    const handler = middleware(async () => new Response('private-test-token https://trusted-backend.example/internal', { status }), 'private-test-token');
    const result = await invoke(handler, body);
    assert.ok(result.status >= 400);
    assert.doesNotMatch(result.text, /private-test-token|trusted-backend/);
    assert.equal(typeof result.body.error, 'string');
  }
  const network = await invoke(middleware(async () => { throw new Error('private-test-token https://trusted-backend.example/internal'); }), body);
  assert.equal(network.status, 502);
  assert.doesNotMatch(network.text, /private-test-token|trusted-backend/);
  const invalidJson = await invoke(middleware(async () => new Response('private-test-token')), body);
  assert.equal(invalidJson.status, 502);
  assert.doesNotMatch(invalidJson.text, /private-test-token/);
  const timeout = await invoke(middleware(async () => { throw new DOMException('private-test-token', 'AbortError'); }), body);
  assert.equal(timeout.status, 504);
  assert.match(timeout.body.error, /timed out/);
  const invalidConfig = createAmazonImportMiddleware({ backendBaseUrl: 'https://private-user:private-test-token@private.example',
    fetchImpl: async () => { throw new Error('must not fetch'); } });
  const result = await invoke(invalidConfig, body);
  assert.equal(result.status, 503);
  assert.doesNotMatch(result.text, /private-test-token|private-user|private.example/);
});
