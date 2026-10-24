import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearcher, normalizeSearch, parseSearchRequest } from '../server/amazon-search.js';
import { createSearchHandler } from '../server/search-handler.js';
import { hasRegisteredModel } from '../server/amazon-import.js';
import worker from '../worker/index.ts';
import { parseAmazonSearchResults } from '../src/lib/amazon-search.ts';

const tableAsin = 'B0F2ML48Y6';
const input = { q: 'oak table', page: 1 };
const providerFixture = () => ({
  search_metadata: { status: 'Success', processed_at: '2026-10-24 12:34:56 UTC', json_endpoint: 'https://serpapi.com/private?api_key=PRIVATE_TEST_VALUE' },
  search_information: { total_results: 125, page: 1 },
  organic_results: [{ asin: tableAsin, title: 'Oak dining table', thumbnail: 'https://m.media-amazon.com/images/table.jpg',
    price: '$176.99', extracted_price: 176.99, rating: 4.7, reviews: 321,
    link: 'https://unrelated.example/?api_key=PRIVATE_TEST_VALUE', stock: 'Only 3 left in stock' }],
  serpapi_pagination: { next: 'https://serpapi.com/search.json?api_key=PRIVATE_TEST_VALUE&page=2' },
});
function request(body: unknown = input, overrides: { method?: string; headers?: Record<string, string>; raw?: string } = {}) {
  const method = overrides.method || 'POST';
  return new Request('https://furniture.example/api/products/search', {
    method, headers: { 'Content-Type': 'application/json', Origin: 'https://furniture.example', 'oai-authenticated-user-id': 'test-user', ...overrides.headers },
    ...(method === 'GET' ? {} : { body: overrides.raw ?? JSON.stringify(body) }),
  });
}
const result = (search = input) => normalizeSearch(providerFixture(), search, new Date('2026-10-24T12:35:00Z'));

test('Search input normalizes spaces and rejects unsupported shapes, controls, lengths and pages', () => {
  assert.deepEqual(parseSearchRequest({ q: '  oak   dining\u00a0table  ' }), { q: 'oak dining table', page: 1 });
  assert.deepEqual(parseSearchRequest({ q: 'x'.repeat(200), page: 10, api_key: 'ignored' }), { q: 'x'.repeat(200), page: 10 });
  for (const invalid of [null, [], 'chair', {}, { q: 22 }, { q: '' }, { q: 'a' }, { q: 'a'.repeat(201) },
    { q: 'oak\ntable' }, { q: 'oak\ttable' }, { q: 'oak\u0085table' },
    ...[null, '2', 0, -1, 11, 1.5, Infinity].map(page => ({ q: 'table', page }))]) assert.throws(() => parseSearchRequest(invalid));
});

test('Search summaries preserve real data and never expose provider or tracking URLs', () => {
  const response = result();
  assert.deepEqual(response, {
    query: 'oak table', page: 1, nextPage: 2, totalResults: 125,
    products: [{ asin: tableAsin, title: 'Oak dining table', url: `https://www.amazon.com/dp/${tableAsin}`,
      imageUrl: 'https://m.media-amazon.com/images/table.jpg', price: { amount: 176.99, currency: 'USD', display: '$176.99' },
      rating: 4.7, ratingsTotal: 321, availability: 'Only 3 left in stock', modelAvailable: true }],
    retrievedAt: '2026-10-24T12:35:00.000Z', providerRetrievedAt: '2026-10-24T12:34:56.000Z', cached: false,
  });
  assert.doesNotMatch(JSON.stringify(response), /PRIVATE_TEST_VALUE|serpapi.com|unrelated.example/);
  assert.deepEqual(parseAmazonSearchResults(response), response);
});

test('Unknown stock, prices, ratings and model availability remain unknown', () => {
  const data = { organic_results: [
    { asin: 'B012345678', title: 'Chair', extracted_price: 100, rating: 5.1, reviews: '1,234', prime: true, delivery: ['Tomorrow'] },
    { asin: 'B012345679', title: 'Another chair', price: '$99.00', extracted_price: -99, rating: -1, reviews: -1 },
  ] };
  const response = normalizeSearch(data, input);
  for (const product of response.products) {
    assert.equal(product.price, null); assert.equal(product.availability, null);
    assert.equal(product.rating, null); assert.equal(product.ratingsTotal, null);
    assert.equal(product.modelAvailable, false);
  }
  assert.equal(response.totalResults, null); assert.equal(response.providerRetrievedAt, null);
});

test('Only valid organic products are returned, deduplicated by normalized ASIN and capped at 100', () => {
  const response = normalizeSearch({
    organic_results: [null, {}, { title: 'Missing ID' }, { asin: 'invalid', title: 'Invalid ID' }, { asin: tableAsin },
      ...providerFixture().organic_results, { asin: tableAsin.toLowerCase(), title: 'Duplicate' }],
    product_ads: { products: [{ asin: 'B012345678', title: 'Advertisement' }] },
    featured_products: [{ asin: 'B012345679', title: 'Featured item' }],
  }, input);
  assert.deepEqual(response.products.map(product => product.asin), [tableAsin]);
  const many = normalizeSearch({ organic_results: Array.from({ length: 105 }, (_, i) => ({ asin: `B${String(i).padStart(9, '0')}`, title: `Item ${i}` })) }, input);
  assert.equal(many.products.length, 100);
});

test('Unsafe product thumbnails and credential fragments never reach the client', () => {
  const candidates = ['http://example.com/image.jpg', 'javascript:alert(1)', 'https://user:password@example.com/a',
    'https://example.com/a?api_key=PRIVATE_TEST_VALUE', 'https://example.com/a?%61pi_key=PRIVATE_TEST_VALUE',
    'https://example.com/a?access-token=PRIVATE_TEST_VALUE', 'https://example.com/a?token=PRIVATE_TEST_VALUE',
    'https://example.com/a?auth=PRIVATE_TEST_VALUE', 'https://example.com/a?key=PRIVATE_TEST_VALUE',
    'https://example.com/a?secret=PRIVATE_TEST_VALUE', 'https://example.com/a?signature=PRIVATE_TEST_VALUE',
    'https://example.com/a?x-amz-credential=PRIVATE_TEST_VALUE',
    'https://example.com/a\\private'];
  for (const thumbnail of candidates) {
    const response = normalizeSearch({ organic_results: [{ asin: tableAsin, title: 'Table', thumbnail }] }, input);
    assert.equal(response.products[0].imageUrl, null, thumbnail);
  }
  const fragment = normalizeSearch({ organic_results: [{ asin: tableAsin, title: 'Table', thumbnail: 'https://example.com/a.jpg#api_key=PRIVATE_TEST_VALUE' }] }, input);
  assert.equal(fragment.products[0].imageUrl, 'https://example.com/a.jpg');
});

test('Model flags cover only registered exact products and the authored table family', () => {
  for (const asin of ['B0F2ML48Y6', 'B0D8P23H61', 'B0D8P1SVLG', 'B0D8NSXYQ6', 'B0F2MJHXBC', 'B0DSZGP1HK', 'B0D8NQHBBH', 'B0C4DGFFCM']) assert.equal(hasRegisteredModel(asin), true);
  for (const asin of ['B012345678', 'B0DBHRNVR6', 'toString', '__proto__', null]) assert.equal(hasRegisteredModel(asin), false);
});

test('Next page requires explicit provider pagination, never a guessed result count', () => {
  const fixture = providerFixture();
  assert.equal(normalizeSearch(fixture, { ...input, page: 10 }).nextPage, null);
  assert.equal(normalizeSearch({ organic_results: [], search_information: { total_results: 1000 } }, input).nextPage, null);
  assert.equal(normalizeSearch({ organic_results: [], pagination: { next: 'https://amazon.com/s?page=2' } }, input).nextPage, 2);
  for (const next of [null, '', ' ', false, 2]) assert.equal(normalizeSearch({ organic_results: [], serpapi_pagination: { next } }, input).nextPage, null);
});

test('Explicit empty results are distinct from incomplete or failed provider responses', () => {
  for (const data of [{ organic_results: [] }, { search_information: { total_results: 0 } },
    { organic_results: [], search_metadata: { status: 'Success' }, search_information: { total_results: 0 }, error: 'No results' }]) assert.deepEqual(normalizeSearch(data, input).products, []);
  for (const data of [null, [], {}, { organic_results: null }, { organic_results: {} }, { organic_results: [null, {}] },
    { organic_results: [], error: 'PRIVATE_TEST_VALUE' },
    { organic_results: [], search_metadata: { status: 'Success' }, error: 'PRIVATE_TEST_VALUE' },
    { organic_results: [], search_metadata: { status: 'Processing' } },
    { organic_results: [], search_parameters: { amazon_domain: 'amazon.co.uk' } }]) {
    assert.throws(() => normalizeSearch(data, input), error => error.code === 'SERPAPI_BAD_RESPONSE' && !error.message.includes('PRIVATE_TEST_VALUE'));
  }
});

test('Oversized or malformed optional text cannot poison an otherwise valid result page', () => {
  const response = normalizeSearch({ organic_results: [
    { asin: tableAsin, title: 'Valid table', stock: 's'.repeat(1001), price: '$' + '1'.repeat(201), extracted_price: 20 },
    { asin: 'B012345678', title: 't'.repeat(2001) },
    { asin: 'B012345679', title: 'Huge price', price: '$1000000000001', extracted_price: 1000000000001 },
  ] }, input);
  assert.equal(response.products.length, 2);
  assert.deepEqual(response.products[0].price, { amount: 20, currency: 'USD', display: null });
  assert.equal(response.products[0].availability, null);
  assert.equal(response.products[1].price, null);
  assert.deepEqual(parseAmazonSearchResults(response), response);
});

test('Provider timestamps use processed time, with safe created-time fallback', () => {
  assert.equal(normalizeSearch({ organic_results: [], search_metadata: { processed_at: 'invalid', created_at: '2026-10-24T12:00:00+02:00' } }, input).providerRetrievedAt, '2026-10-24T10:00:00.000Z');
  assert.equal(normalizeSearch({ organic_results: [], search_metadata: { processed_at: 'private provider link' } }, input).providerRetrievedAt, null);
});

test('Search transport sends only supported Amazon search parameters with server credentials', async () => {
  let calls = 0;
  const search = createSearcher({ SERPAPI_API_KEY: 'PRIVATE_TEST_VALUE' }, async function(this: unknown, value: URL, init: RequestInit) {
    calls++; assert.equal(this, globalThis);
    const url = new URL(value);
    assert.equal(url.origin + url.pathname, 'https://serpapi.com/search.json');
    assert.deepEqual(Object.fromEntries(url.searchParams), { engine: 'amazon', k: 'oak table', page: '3', amazon_domain: 'amazon.com', language: 'en_US', api_key: 'PRIVATE_TEST_VALUE', output: 'json' });
    assert.equal(init.redirect, 'manual'); assert.equal(init.method, 'GET'); assert.ok(init.signal instanceof AbortSignal);
    return Response.json(providerFixture());
  });
  const response = await search({ q: '  oak  table ', page: 3 });
  assert.equal(response.page, 3); assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(response), /PRIVATE_TEST_VALUE/);
});

test('Method, origin, identity, content type and validation are checked before provider use', async () => {
  let calls = 0;
  const handler = createSearchHandler({ search: async search => { calls++; return result(search); } });
  assert.equal((await handler(request(input, { method: 'GET' }))).status, 405);
  assert.equal((await handler(request(input, { headers: { Origin: 'https://evil.example' } }))).status, 403);
  assert.equal((await handler(request(input, { headers: { 'oai-authenticated-user-id': '' } }))).status, 401);
  assert.equal((await handler(request(input, { headers: { 'Content-Type': 'text/plain' } }))).status, 415);
  assert.equal((await handler(request(input, { headers: { 'Content-Type': 'application/jsonp' } }))).status, 415);
  for (const body of [null, {}, { q: 'x' }, { q: 'table', page: 11 }]) assert.equal((await handler(request(body))).status, 400);
  assert.equal((await handler(request(input, { raw: '{' }))).status, 400);
  assert.equal(calls, 0);
  assert.equal((await handler(request())).status, 200); assert.equal(calls, 1);
});

test('Declared and streamed request bodies are bounded to 4 KB without provider calls', async () => {
  let calls = 0;
  const handler = createSearchHandler({ search: async () => { calls++; return result(); } });
  assert.equal((await handler(request(input, { headers: { 'Content-Length': '4097' } }))).status, 413);
  assert.equal((await handler(request(input, { raw: ' '.repeat(4097) }))).status, 413);
  // Byte bounds matter for multibyte strings, even without Content-Length.
  assert.equal((await handler(request(input, { raw: 'é'.repeat(2049) }))).status, 413);
  assert.equal(calls, 0);
});

test('Concurrent identical searches coalesce and cache for one hour, with page-specific keys', async () => {
  let calls = 0, clock = 1000;
  const handler = createSearchHandler({ search: async search => { calls++; return result(search); }, now: () => clock });
  const responses = await Promise.all([handler(request()), handler(request({ q: '  oak   table ', page: 1 }))]);
  assert.ok(responses.every(response => response.status === 200)); assert.equal(calls, 1);
  const cached = await handler(request());
  assert.equal((await cached.json()).cached, true); assert.equal(cached.headers.get('Cache-Control'), 'no-store');
  await handler(request({ ...input, page: 2 })); assert.equal(calls, 2);
  clock += 3600000;
  assert.equal((await (await handler(request())).json()).cached, false); assert.equal(calls, 3);
});

test('Search cache keeps at most 100 query and page entries', async () => {
  let calls = 0;
  const handler = createSearchHandler({ search: async search => { calls++; return result(search); } });
  for (let i = 0; i < 101; i++) assert.equal((await handler(request({ q: `table ${i}` }, { headers: { 'oai-authenticated-user-id': `user-${i}` } }))).status, 200);
  assert.equal(calls, 101);
  assert.equal((await (await handler(request({ q: 'table 100' }))).json()).cached, true);
  await handler(request({ q: 'table 0' })); assert.equal(calls, 102);
});

test('Per-user lookup limits reset after one minute and cache hits do not spend allowance', async () => {
  let calls = 0, clock = 1000;
  const handler = createSearchHandler({ search: async search => { calls++; return result(search); }, now: () => clock });
  for (let i = 0; i < 8; i++) assert.equal((await handler(request({ q: `table ${i}` }))).status, 200);
  const limited = await handler(request({ q: 'ninth table' }));
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60'); assert.equal(calls, 8);
  assert.equal((await handler(request({ q: 'table 0' }))).status, 200); assert.equal(calls, 8);
  assert.equal((await handler(request({ q: 'other user table' }, { headers: { 'oai-authenticated-user-id': 'different-user' } }))).status, 200);
  clock += 60000;
  assert.equal((await handler(request({ q: 'ninth table' }))).status, 200); assert.equal(calls, 10);
});

test('At most four distinct searches run, while duplicates can join an existing search', async () => {
  const releases: (() => void)[] = [];
  let entered!: () => void;
  const fourStarted = new Promise<void>(resolve => { entered = resolve; });
  const handler = createSearchHandler({ search: search => new Promise(resolve => {
    releases.push(() => resolve(result(search))); if (releases.length === 4) entered();
  }) });
  const running = [0, 1, 2, 3].map(i => handler(request({ q: `table ${i}` })));
  await fourStarted;
  const duplicate = handler(request({ q: 'table 0' }));
  const busy = await handler(request({ q: 'table 4' }));
  assert.equal(busy.status, 503); assert.equal(busy.headers.get('Retry-After'), '2');
  releases.forEach(release => release());
  assert.ok((await Promise.all([...running, duplicate])).every(response => response.status === 200));
  assert.equal(releases.length, 4);
});

test('Failure responses never expose credentials and are not cached', async () => {
  let calls = 0;
  const search = createSearcher({ SERPAPI_API_KEY: 'PRIVATE_TEST_VALUE' }, async () => {
    calls++; throw new Error('https://serpapi.com/search.json?api_key=PRIVATE_TEST_VALUE');
  });
  const handler = createSearchHandler({ search });
  for (let i = 0; i < 2; i++) {
    const response = await handler(request());
    assert.equal(response.status, 502);
    const body = await response.text(); assert.match(body, /SERPAPI_UNAVAILABLE/); assert.doesNotMatch(body, /PRIVATE_TEST_VALUE|search.json/);
  }
  assert.equal(calls, 2);
  const unexpected = createSearchHandler({ search: () => { throw new Error('PRIVATE_TEST_VALUE'); } });
  assert.doesNotMatch(await (await unexpected(request())).text(), /PRIVATE_TEST_VALUE/);
});

test('Quota, configuration, timeout and malformed provider failures retain safe distinct codes', async () => {
  const cases = [
    { fetch: async () => new Response('PRIVATE_TEST_VALUE', { status: 429, headers: { 'Retry-After': '30' } }), code: 'SERPAPI_QUOTA_EXCEEDED', status: 503 },
    { fetch: async () => { throw new DOMException('PRIVATE_TEST_VALUE', 'TimeoutError'); }, code: 'SERPAPI_TIMEOUT', status: 504 },
    { fetch: async () => Response.json({}), code: 'SERPAPI_BAD_RESPONSE', status: 502 },
  ];
  for (const entry of cases) {
    const handler = createSearchHandler({ search: createSearcher({ SERPAPI_API_KEY: 'PRIVATE_TEST_VALUE' }, entry.fetch) });
    const response = await handler(request()), text = await response.text();
    assert.equal(response.status, entry.status); assert.match(text, new RegExp(entry.code)); assert.doesNotMatch(text, /PRIVATE_TEST_VALUE/);
  }
  const missing = await createSearchHandler()(request(), {});
  assert.equal(missing.status, 503); assert.match(await missing.text(), /SERPAPI_NOT_CONFIGURED/);
});

test('Worker routes Amazon searches to authenticated search handling before static assets', async () => {
  let assetCalls = 0;
  const response = await worker.fetch(request(input, { headers: { 'oai-authenticated-user-id': '' } }), { ASSETS: { fetch: async () => { assetCalls++; return new Response('asset'); } } });
  assert.equal(response.status, 401); assert.equal(assetCalls, 0);
});
