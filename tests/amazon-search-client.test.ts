import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportError, importAmazonProduct } from '../src/lib/amazon.ts';
import { parseAmazonSearchResults, searchAmazonProducts } from '../src/lib/amazon-search.ts';

const product = () => ({
  asin: 'B0F2ML48Y6', title: 'Oak dining table', url: 'https://www.amazon.com/dp/B0F2ML48Y6',
  imageUrl: 'https://m.media-amazon.com/images/I/table.jpg',
  price: { amount: 176.99, currency: 'USD', display: '$176.99' }, rating: 4.6, ratingsTotal: 214,
  availability: null, modelAvailable: true,
});
const result = () => ({
  query: 'oak table', page: 1, nextPage: 2, totalResults: 184,
  products: [product()], retrievedAt: '2026-10-24T15:45:00.000Z', providerRetrievedAt: null, cached: false,
});

test('Search parser accepts exact normalized products without inventing missing information', () => {
  assert.deepEqual(parseAmazonSearchResults(result()), result());
  const sparse = { ...product(), imageUrl: null, price: null, rating: null, ratingsTotal: null, modelAvailable: false };
  const data = { ...result(), products: [sparse], nextPage: null, totalResults: null, cached: true };
  assert.deepEqual(parseAmazonSearchResults(data), data);
  assert.deepEqual(parseAmazonSearchResults({ ...result(), products: [], nextPage: null }).products, []);
  const clean = parseAmazonSearchResults({ ...result(), apiKey: 'discard-me', products: [{ ...product(), secret: 'discard-me' }] });
  assert.ok(!JSON.stringify(clean).includes('discard-me'));
});

test('Search parser rejects noncanonical Amazon links, duplicate IDs, and unsafe images', () => {
  const badProducts = [
    { ...product(), asin: 'wrong' },
    { ...product(), url: 'https://amazon.com.evil.test/dp/B0F2ML48Y6' },
    { ...product(), url: 'https://www.amazon.com/dp/B012345678' },
    { ...product(), url: 'https://www.amazon.com/dp/B0F2ML48Y6?api_key=secret' },
    ...['javascript:alert(1)', 'http://example.com/image.jpg', 'https://user:secret@example.com/image.jpg',
      'https://example.com/image.jpg?api_key=secret', 'https://example.com/image.jpg?accessToken=secret',
      'https://example.com/image.jpg?x-amz-signature=secret', 'https://example.com/image.jpg#token=secret',
      `https://example.com/${'x'.repeat(4100)}`, ' https://example.com/image.jpg'].map(imageUrl => ({ ...product(), imageUrl })),
  ];
  for (const value of badProducts) assert.throws(() => parseAmazonSearchResults({ ...result(), products: [value] }), ImportError);
  assert.throws(() => parseAmazonSearchResults({ ...result(), products: [product(), product()] }), ImportError);
});

test('Search parser bounds fields, prices, ratings, pages, counts, and timestamps', () => {
  for (const patch of [
    { title: '' }, { title: 'x'.repeat(2001) }, { title: 'bad\u0000text' },
    { price: { amount: -1, currency: 'USD', display: null } },
    { price: { amount: Infinity, currency: 'USD', display: null } },
    { price: { amount: 10, currency: 'usd', display: null } },
    { price: { amount: 10, currency: 'USD', display: 'x'.repeat(201) } },
    { rating: 5.1 }, { rating: NaN }, { ratingsTotal: -1 }, { ratingsTotal: 1.5 },
    { availability: 'x'.repeat(1001) }, { modelAvailable: 'yes' }, { imageUrl: undefined },
  ]) assert.throws(() => parseAmazonSearchResults({ ...result(), products: [{ ...product(), ...patch }] }));
  for (const patch of [
    { query: 'x' }, { query: 'x'.repeat(201) }, { query: 'oak\ntable' }, { page: 0 }, { page: 11 }, { page: 1.5 },
    { nextPage: 1 }, { nextPage: 11 }, { nextPage: 2.5 }, { totalResults: -1 }, { totalResults: 0.5 },
    { totalResults: Number.MAX_SAFE_INTEGER + 1 }, { retrievedAt: 'not-a-date' },
    { retrievedAt: '1' }, { providerRetrievedAt: 'not-a-date' }, { cached: 1 },
    { products: Array.from({ length: 101 }, product) },
  ]) assert.throws(() => parseAmazonSearchResults({ ...result(), ...patch }));
});

test('Search includes same-origin site sign-in while keeping provider credentials server-side', async t => {
  const controller = new AbortController();
  const data = { ...result(), page: 3, nextPage: 4 };
  const mock = t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.equal(url, '/api/products/search');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.redirect, 'error');
    assert.deepEqual(init?.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(init!.body as string), { q: 'oak table', page: 3 });
    assert.equal(init?.signal, controller.signal);
    return Response.json(data);
  });
  assert.deepEqual(await searchAmazonProducts('  oak   table  ', 3, controller.signal), data);
  assert.equal(mock.mock.calls.length, 1);
});

test('Invalid search queries and pages never spend a provider request', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(result()));
  for (const query of ['', ' ', 'x', 'x'.repeat(201), 'oak\u0000table', 'oak\ntable']) {
    await assert.rejects(searchAmazonProducts(query), error => error instanceof ImportError && error.code === 'INVALID_QUERY');
  }
  for (const page of [0, 11, 1.5, NaN, Infinity]) {
    await assert.rejects(searchAmazonProducts('oak table', page), error => error instanceof ImportError && error.code === 'INVALID_PAGE');
  }
  assert.equal(mock.mock.calls.length, 0);
});

test('Search errors explain service access failures without asking guests to sign in or exposing provider secrets', async t => {
  for (const [status, code, expected] of [
    [401, 'SIGN_IN_REQUIRED', 'SERVICE_ACCESS_FAILED'],
    [403, 'ORIGIN_NOT_ALLOWED', 'SERVICE_ACCESS_FAILED'],
    [400, 'INVALID_SEARCH', 'INVALID_SEARCH'],
    [429, 'UNKNOWN', 'RATE_LIMITED'],
    [503, 'SERPAPI_QUOTA_EXCEEDED', 'SERPAPI_QUOTA_EXCEEDED'],
    [502, 'https://secret.invalid?api_key=SECRET', 'SEARCH_FAILED'],
    [500, '__proto__', 'SEARCH_FAILED'],
  ] as const) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code, message: 'api_key=SECRET' } }, { status }));
    await assert.rejects(searchAmazonProducts('oak table'), error => {
      assert.ok(error instanceof ImportError);
      assert.equal(error.code, expected);
      assert.ok(!`${error.message} ${error.code}`.includes('SECRET'));
      assert.doesNotMatch(error.message, /sign in|log in/i);
      return true;
    });
    mock.mock.restore();
  }
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('<html>Sign in</html>', { status: 401 }));
  await assert.rejects(searchAmazonProducts('oak table'), error => error instanceof ImportError && error.code === 'SERVICE_ACCESS_FAILED');
  mock.mock.restore();
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('https://secret.invalid?api_key=SECRET'); });
  await assert.rejects(searchAmazonProducts('oak table'), error => error instanceof ImportError && error.code === 'SEARCH_UNAVAILABLE' && !error.message.includes('SECRET'));
});

test('Malformed, oversized, or mismatched search responses never reach the gallery', async t => {
  for (const response of [
    new Response('bad-json SECRET'),
    Response.json({ ...result(), products: [{ ...product(), imageUrl: 'http://unsafe.test/image' }] }),
    Response.json({ ...result(), query: 'other query' }),
    Response.json({ ...result(), page: 2, nextPage: 3 }),
    new Response(' '.repeat(1_000_001)),
    new Response('{}', { headers: { 'Content-Length': '1000001' } }),
  ]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(searchAmazonProducts('oak table'), error => error instanceof ImportError && error.code === 'INVALID_SEARCH_RESULTS' && !error.message.includes('SECRET'));
    mock.mock.restore();
  }
});

test('Aborted searches preserve cancellation before fetch, during fetch, and while reading results', async t => {
  const controller = new AbortController();
  controller.abort();
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(result()));
  await assert.rejects(searchAmazonProducts('oak table', 1, controller.signal), error => error === controller.signal.reason);
  assert.equal(mock.mock.calls.length, 0);
  mock.mock.restore();

  const inFlight = new AbortController();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    inFlight.abort(new DOMException('Search cancelled', 'AbortError'));
    throw inFlight.signal.reason;
  });
  await assert.rejects(searchAmazonProducts('oak table', 1, inFlight.signal), error => error === inFlight.signal.reason);
  fetchMock.mock.restore();

  const reading = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(stream) { reading.abort(); stream.error(reading.signal.reason); },
  })));
  await assert.rejects(searchAmazonProducts('oak table', 1, reading.signal), error => error === reading.signal.reason);
});

test('Product imports support private Site cookies without requiring signed-in guest requests', async t => {
  const controller = new AbortController();
  const listing = {
    asin: 'B0F2ML48Y6', title: 'Oak dining table', brand: null,
    url: 'https://www.amazon.com/dp/B0F2ML48Y6', images: [], price: null,
    availability: null, features: [], dimensionText: null, dimensions: null,
    retrievedAt: '2026-10-24T15:45:00.000Z', modelNote: null,
  };
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.equal(url, '/api/products/import');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.redirect, 'error');
    assert.deepEqual(init?.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(init!.body as string), { url: listing.url });
    assert.equal(init?.signal, controller.signal);
    return Response.json({ listing, product: null });
  });
  assert.deepEqual(await importAmazonProduct(listing.url, controller.signal), { listing, product: null });
});

test('Guest import access errors and provider failures display safe retry messages', async t => {
  for (const [status, code, expected] of [
    [401, 'SIGN_IN_REQUIRED', 'SERVICE_ACCESS_FAILED'],
    [403, 'ORIGIN_NOT_ALLOWED', 'SERVICE_ACCESS_FAILED'],
    [400, 'INVALID_LINK', 'INVALID_LINK'],
    [502, 'SERPAPI_AUTH_FAILED', 'SERPAPI_AUTH_FAILED'],
    [500, 'api_key=SECRET', 'IMPORT_FAILED'],
    [500, '__proto__', 'IMPORT_FAILED'],
  ] as const) {
    for (const response of [
      Response.json({ error: { code, message: 'Sign in at https://secret.invalid?api_key=SECRET' } }, { status }),
      ...(status === 401 || status === 403 ? [new Response('<html>Sign in SECRET</html>', { status })] : []),
    ]) {
      const mock = t.mock.method(globalThis, 'fetch', async () => response);
      await assert.rejects(importAmazonProduct('https://www.amazon.com/dp/B0F2ML48Y6'), error => {
        assert.ok(error instanceof ImportError);
        assert.equal(error.code, expected);
        assert.doesNotMatch(`${error.message} ${error.code}`, /SECRET|sign in|log in/i);
        return true;
      });
      mock.mock.restore();
    }
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('https://secret.invalid?api_key=SECRET'); });
  await assert.rejects(importAmazonProduct('https://www.amazon.com/dp/B0F2ML48Y6'), error => error instanceof ImportError && error.code === 'IMPORT_UNAVAILABLE' && !error.message.includes('SECRET'));
});
