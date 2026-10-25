import test from 'node:test';
import assert from 'node:assert/strict';
import { getAmazonProductModel, ImportError, importAmazonProduct, parseAmazonModel, parseAmazonProductResult, parseListing } from '../src/lib/amazon.ts';
import { createImportedItem, parseWorkspace } from '../src/lib/workspace.ts';
import { resolveModelItem } from '../src/lib/model-resolution.ts';

const asin = 'B0F2ML48Y6';
const listing = () => ({
  asin, title: 'Oak dining table', brand: null, url: `https://www.amazon.com/dp/${asin}`,
  images: ['https://m.media-amazon.com/images/I/table.jpg'], price: null, availability: null,
  features: [], dimensionText: null, dimensions: { width: 1.2, height: 0.75, depth: 1.2 },
  retrievedAt: '2026-10-24T15:45:00.000Z', modelNote: null,
});
const product = () => ({
  id: `amazon-${asin}`, name: 'Oak dining table', category: 'Tables', tagline: 'A dining table',
  description: 'Generated from a product photo.', material: 'Unknown', background: '#e9ede5',
  dimensions: { width: 1.2, height: 0.75, depth: 1.2 },
  variants: [{ id: asin, name: 'Amazon product', color: '#808080', asin,
    productUrl: `https://www.amazon.com/dp/${asin}`, modelSrc: `/api/products/models/${asin}/${'a'.repeat(64)}.glb` }],
});
const ready = () => ({ listing: listing(), product: product(), model: { status: 'ready', source: 'cache' } });

test('Model metadata accepts only known states, sources, and bounded retry delays and drops unknown fields', () => {
  for (const status of ['ready', 'not_configured', 'pending', 'failed', 'storage_unavailable', 'no_image']) {
    assert.deepEqual(parseAmazonModel({ status, error: 'api_key=SECRET', providerJobId: 'SECRET' }), { status });
  }
  assert.deepEqual(parseAmazonModel({ status: 'pending', retryAfterMs: 4000 }), { status: 'pending', retryAfterMs: 4000 });
  for (const value of [null, [], {}, { status: 'done' }, { status: 'pending', source: 'SECRET' },
    ...[-1, NaN, Infinity, 0.5, 300001, '4000'].map(retryAfterMs => ({ status: 'pending', retryAfterMs }))]) {
    assert.throws(() => parseAmazonModel(value), error => error instanceof ImportError && error.code === 'INVALID_MODEL_RESPONSE' && !error.message.includes('SECRET'));
  }
});

test('Model results attach sanitized state to the listing and survive saved-item persistence', () => {
  const result = parseAmazonProductResult({ ...ready(), model: { ...ready().model, secret: 'SECRET' },
    listing: { ...listing(), unexpected: 'SECRET' } }, asin);
  assert.deepEqual(result.listing.model, { status: 'ready', source: 'cache' });
  assert.ok(!JSON.stringify(result.listing).includes('SECRET'));
  const item = createImportedItem(result.listing, result.product);
  const restored = parseWorkspace(JSON.parse(JSON.stringify({ items: [item], layouts: [] }))).items[0];
  assert.equal(restored.id, item.id);
  assert.equal(restored.createdAt, item.createdAt);
  assert.equal(restored.product?.variants[0].asin, asin);
  assert.deepEqual(restored.listing?.model, result.listing.model);
  assert.equal(restored.variantId, asin);
  assert.deepEqual(parseAmazonProductResult({ listing: listing(), product: null }), { listing: listing(), product: null });
  assert.equal(parseListing(listing()).model, undefined);
});

test('Mismatched product variants and contradictory model states cannot enter the AR preview', () => {
  const different = 'B0D8P23H61';
  for (const data of [
    { ...ready(), listing: { ...listing(), asin: different, url: `https://www.amazon.com/dp/${different}` } },
    { ...ready(), product: { ...product(), variants: [{ ...product().variants[0], asin: different, productUrl: `https://www.amazon.com/dp/${different}` }] } },
    { ...ready(), product: { ...product(), variants: [{ ...product().variants[0], productUrl: `https://www.amazon.com/dp/${different}` }] } },
    { ...ready(), product: null },
    { ...ready(), model: { status: 'pending' } },
  ]) assert.throws(() => parseAmazonProductResult(data, asin), ImportError);
  const registered = { ...product(), variants: [...product().variants, { ...product().variants[0], id: different, asin: different, productUrl: `https://www.amazon.com/dp/${different}` }] };
  assert.equal(parseAmazonProductResult({ ...ready(), product: registered, model: { status: 'ready', source: 'registered' } }, asin).product?.variants.length, 2);
});

test('Checking a saved model requests its exact ASIN with same-origin Site access', async t => {
  const controller = new AbortController();
  const mock = t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.equal(url, `/api/products/models/${asin}`);
    assert.equal(init?.method, 'GET');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.signal, controller.signal);
    assert.equal(init?.body, undefined);
    return Response.json(ready());
  });
  const result = await getAmazonProductModel(asin, controller.signal);
  assert.equal(result.listing.model?.source, 'cache');
  assert.equal(mock.mock.calls.length, 1);
  for (const invalid of ['', '../import', 'b0f2ml48y6', `${asin}?key=SECRET`, 'B01234567']) {
    await assert.rejects(getAmazonProductModel(invalid), error => error instanceof ImportError && error.code === 'INVALID_ASIN');
  }
  assert.equal(mock.mock.calls.length, 1);
});

test('Imports preserve the dummy result and verify the selected Amazon ASIN', async t => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ listing: listing(), product: null, model: { status: 'not_configured' } }));
  const result = await importAmazonProduct(`https://www.amazon.com/Product/dp/${asin}?ref=search`);
  assert.equal(result.product, null);
  assert.deepEqual(result.listing.model, { status: 'not_configured' });
  await assert.rejects(importAmazonProduct('https://www.amazon.com/dp/B0D8P23H61'), error => error instanceof ImportError && error.code === 'PRODUCT_MISMATCH');
  for(const url of ['B0D8P23H61','amazon.com/dp/B0D8P23H61','https://smile.amazon.com/gp/product/B0D8P23H61']){
    await assert.rejects(importAmazonProduct(url),error=>error instanceof ImportError&&error.code==='PRODUCT_MISMATCH');
  }
  assert.equal(mock.mock.calls.length, 5);
});

test('A resolved model updates the preview and exact unmodeled saved copy without replacing IDs or selected finishes',()=>{
  const result=parseAmazonProductResult(ready(),asin);
  const pending=createImportedItem({...listing(),model:{status:'pending'}},null);
  const saved={...pending,id:'older-saved-item',createdAt:'2026-10-20T11:00:00.000Z'};
  const resolved=resolveModelItem(pending,pending.id,result);
  assert.equal(resolved.id,pending.id);assert.equal(resolved.createdAt,pending.createdAt);
  assert.equal(resolved.product?.variants[0].asin,asin);
  const savedResolved=resolveModelItem(saved,pending.id,result,true);
  assert.equal(savedResolved.id,saved.id);assert.equal(savedResolved.createdAt,saved.createdAt);
  assert.deepEqual(savedResolved.product,result.product);
  assert.equal(resolveModelItem(saved,pending.id,result),saved,'an unrelated preview cannot be changed by ASIN alone');
  const other={...saved,listing:{...saved.listing!,asin:'B0D8P23H61'}};
  assert.equal(resolveModelItem(other,pending.id,result,true),other);
  const changedFinish={...resolved,product:{...result.product!,variants:[...result.product!.variants,
    {...result.product!.variants[0],id:'black',asin:'B0D8P23H61',productUrl:'https://www.amazon.com/dp/B0D8P23H61'}]},variantId:'black'};
  assert.equal(resolveModelItem(changedFinish,pending.id,result,true),changedFinish);
  assert.equal(resolveModelItem(resolved,pending.id,{listing:pending.listing!,product:null}),resolved,'temporary missing state must not remove a usable model');
});

test('Model status failures expose safe messages and reject responses without model metadata', async t => {
  for (const [status, code, expected] of [
    [404, 'MODEL_NOT_FOUND', 'MODEL_NOT_FOUND'],
    [503, 'MODEL_STORAGE_UNAVAILABLE', 'MODEL_STORAGE_UNAVAILABLE'],
    [500, 'MODEL_LOOKUP_FAILED', 'MODEL_LOOKUP_FAILED'],
    [401, 'SECRET', 'SERVICE_ACCESS_FAILED'],
    [500, '__proto__', 'IMPORT_FAILED'],
  ] as const) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code, message: 'api_key=SECRET' } }, { status }));
    await assert.rejects(getAmazonProductModel(asin), error => error instanceof ImportError && error.code === expected && !error.message.includes('SECRET'));
    mock.mock.restore();
  }
  const missing = t.mock.method(globalThis, 'fetch', async () => Response.json({ listing: listing(), product: null }));
  await assert.rejects(getAmazonProductModel(asin), error => error instanceof ImportError && error.code === 'INVALID_MODEL_RESPONSE');
  missing.mock.restore();
  const mismatch = t.mock.method(globalThis, 'fetch', async () => Response.json(ready()));
  await assert.rejects(getAmazonProductModel('B0D8P23H61'), error => error instanceof ImportError && error.code === 'PRODUCT_MISMATCH');
  mismatch.mock.restore();
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('api_key=SECRET'); });
  await assert.rejects(getAmazonProductModel(asin), error => error instanceof ImportError && error.code === 'MODEL_LOOKUP_FAILED' && !error.message.includes('SECRET'));
});

test('Model status checks preserve cancellation before and during fetch', async t => {
  const controller = new AbortController();controller.abort();
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(ready()));
  await assert.rejects(getAmazonProductModel(asin, controller.signal), error => error === controller.signal.reason);
  assert.equal(mock.mock.calls.length, 0);mock.mock.restore();
  const inFlight = new AbortController();
  t.mock.method(globalThis, 'fetch', async () => { inFlight.abort();throw inFlight.signal.reason; });
  await assert.rejects(getAmazonProductModel(asin, inFlight.signal), error => error === inFlight.signal.reason);
});
