import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListing } from '../src/lib/amazon.ts';
import type { AmazonColorOption, AmazonListing } from '../src/lib/amazon.ts';
import type { FurnitureProduct } from '../src/lib/products.ts';
import {
  availableItemVariants, createImportedItem, createLayout, createProductItem, duplicateLayout,
  parseWorkspace, placeItem, placeholderProduct, readWorkspace, saveWorkspace, selectItemVariant,
} from '../src/lib/workspace.ts';

const oak = 'B0F2ML48Y6', black = 'B0D8P23H61', white = 'B0DSZGP1HK', unmodeled = 'B012345678';
const url = (asin: string) => `https://www.amazon.com/dp/${asin}`;
const option = (asin: string, name: string): AmazonColorOption => ({
  asin, name, url: url(asin), imageUrl: 'https://m.media-amazon.com/images/color.jpg', selected: asin === oak,
});
const originalListing: AmazonListing = {
  asin: oak, title: 'Round dining table', brand: 'LITTLE TREE', url: url(oak), images: [],
  price: null, availability: null, features: [], dimensionText: null, dimensions: null,
  retrievedAt: '2026-10-24T12:00:00.000Z', modelNote: null,
};
const listing: AmazonListing = { ...originalListing, colors: { status: 'observed', options: [
  option(oak, 'Natural Oak'), option(black, 'Black'), option(unmodeled, 'Blue'),
] } };
const product: FurnitureProduct = { ...placeholderProduct, variants: [
  { ...placeholderProduct.variants[0], asin: oak, productUrl: url(oak) },
  { ...placeholderProduct.variants.find(variant => variant.id === 'black')!, asin: black, productUrl: url(black) },
  { ...placeholderProduct.variants.find(variant => variant.id === 'white')!, asin: white, productUrl: url(white) },
] };

test('Only observed colors with matching model ASINs become selectable', () => {
  const item = createImportedItem(parseListing(listing), product);
  const variants = availableItemVariants(item);
  assert.deepEqual(variants.map(variant => variant.id), ['oak', 'black']);
  assert.equal(variants[0].name, 'Natural Oak');
  assert.equal(variants[1].productUrl, url(black));
  assert.equal(selectItemVariant(item, 'black').variantId, 'black');
  assert.throws(() => selectItemVariant(item, 'white'), /available finish/);
  assert.throws(() => selectItemVariant(item, 'Blue'), /available finish/);
  assert.deepEqual(item.product, product);
  assert.equal(item.variantId, 'oak');
  assert.deepEqual(availableItemVariants(createImportedItem(listing, null)), []);
});

test('Missing, unconfirmed and explicit empty color metadata never unlock the generic palette', () => {
  for (const colors of [undefined, { status: 'unconfirmed' as const, options: [] }, { status: 'observed' as const, options: [] }]) {
    const source = colors ? { ...originalListing, colors } : originalListing;
    const item = createImportedItem(parseListing(source), product);
    assert.deepEqual(availableItemVariants(item), []);
    assert.throws(() => selectItemVariant(item, 'black'), /available finish/);
    const restored = parseWorkspace(JSON.parse(JSON.stringify({ items: [item], layouts: [placeItem(createLayout('Room'), item)] })));
    assert.equal(restored.items.length, 1);
    assert.equal(restored.layouts[0].items.length, 1);
    for (const saved of [restored.items[0], restored.layouts[0].items[0]]) assert.deepEqual(availableItemVariants(saved), []);
  }
});

test('Legacy imported appearances stay visible without becoming selectable after loading', () => {
  const item = { ...createImportedItem(originalListing, product), variantId: 'white' };
  const room = placeItem(createLayout('Study'), item);
  const restored = parseWorkspace(JSON.parse(JSON.stringify({ items: [item], layouts: [room] })));
  for (const saved of [restored.items[0], restored.layouts[0].items[0]]) {
    assert.equal(saved.variantId, 'white');
    assert.equal(saved.product?.variants.length, 3);
    assert.deepEqual(availableItemVariants(saved), []);
    assert.throws(() => selectItemVariant(saved, 'black'), /available finish/);
  }
});

test('Observed selections survive saved-item, layout, copy and device-storage round trips', () => {
  const item = selectItemVariant(createImportedItem(listing, product), 'black');
  const room = placeItem(createLayout('Dining room'), item);
  room.items[0] = { ...room.items[0], x: .4, z: -.2, rotation: 135 };
  const workspace = { items: [item], layouts: [room, duplicateLayout(room)] };
  const storage = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  try {
    assert.equal(saveWorkspace(workspace), true);
    assert.deepEqual(readWorkspace(), workspace);
    for (const saved of [readWorkspace().items[0], ...readWorkspace().layouts.flatMap(layout => layout.items)]) {
      assert.equal(saved.variantId, 'black');
      assert.deepEqual(availableItemVariants(saved).map(variant => variant.id), ['oak', 'black']);
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('Retired saved colors fall back to the source ASIN while preserving layout and model', () => {
  const item = { ...createImportedItem(listing, product), variantId: 'white' };
  const room = placeItem(createLayout('Dining room'), item);
  // Simulate an old layout that still contains the retired choice.
  room.items[0] = { ...room.items[0], variantId: 'white', x: .2, z: -.3, rotation: 90 };
  const restored = parseWorkspace({ items: [item], layouts: [room] });
  for (const saved of [restored.items[0], restored.layouts[0].items[0]]) {
    assert.equal(saved.variantId, 'oak');
    assert.deepEqual(saved.product, product);
    assert.equal(saved.listing?.asin, oak);
  }
  assert.equal(restored.layouts[0].items[0].x, .2);
  assert.equal(restored.layouts[0].items[0].z, -.3);
  assert.equal(restored.layouts[0].items[0].rotation, 90);
  const missingSource = { ...product, variants: [product.variants[2], product.variants[1]] };
  const fallback = parseWorkspace({ items: [{ ...item, product: missingSource }], layouts: [] }).items[0];
  assert.equal(fallback.variantId, 'black');
});

test('Model variants without provenance are never matched by color name alone', () => {
  const item = createImportedItem(listing, placeholderProduct);
  assert.deepEqual(availableItemVariants(item), []);
  assert.throws(() => selectItemVariant(item, 'black'), /available finish/);
});

test('Sample and catalog items keep their existing independent color controls', () => {
  const sample = createProductItem('https://example.com/table');
  assert.equal(availableItemVariants(sample), sample.product.variants);
  const selected = selectItemVariant(sample, 'white');
  assert.equal(selected.variantId, 'white');
  const restored = parseWorkspace({ items: [selected], layouts: [placeItem(createLayout('Room'), selected)] });
  assert.equal(restored.items[0].variantId, 'white');
  assert.equal(availableItemVariants(restored.items[0]).length, placeholderProduct.variants.length);
});

test('Color metadata validates provenance, canonical links, uniqueness and selection identity', () => {
  assert.deepEqual(parseListing(originalListing), originalListing);
  assert.deepEqual(parseListing(listing), listing);
  const badOptions: unknown[] = [
    null, {}, { ...option(oak, 'Oak'), asin: 'bad' }, { ...option(oak, 'Oak'), asin: oak.toLowerCase() },
    { ...option(oak, 'Oak'), selected: false }, { ...option(black, 'Black'), selected: true },
    { ...option(oak, 'Oak'), selected: 'true' }, { ...option(oak, 'Oak'), name: '' },
    { ...option(oak, 'Oak'), name: ' Oak ' }, { ...option(oak, 'Oak'), name: 'a'.repeat(201) },
    { ...option(oak, 'Oak'), name: 'Oak\nBlack' }, { ...option(oak, 'Oak'), url: url(black) },
    { ...option(oak, 'Oak'), url: `${url(oak)}?tag=other` },
    { ...option(oak, 'Oak'), url: `https://www.amazon.com.evil.example/dp/${oak}` },
  ];
  for (const entry of badOptions) assert.throws(() => parseListing({ ...listing, colors: { status: 'observed', options: [entry] } }));
  for (const colors of [null, [], {}, { status: 'unknown', options: [] },
    { status: 'observed', options: [option(oak, 'Oak'), option(oak, 'Natural')] },
    { status: 'observed', options: Array.from({ length: 101 }, () => option(oak, 'Oak')) },
    { status: 'unconfirmed', options: [option(oak, 'Oak')] },
  ]) assert.throws(() => parseListing({ ...listing, colors }));
  assert.deepEqual(parseListing({ ...listing, colors: { status: 'observed', options: [option(black, 'Black')] } }).colors?.options.length, 1);
});

test('Color images reject credentials, unsafe protocols, fragments and unbounded URLs', () => {
  const unsafe = [
    'http://example.com/color.jpg', 'javascript:alert(1)', 'data:image/png;base64,a',
    'https://user:password@example.com/color.jpg', 'https://example.com/color.jpg#secret',
    ...['api_key', 'token', 'access_token', 'signature', 'x-amz-credential', 'secret', 'key']
      .map(key => `https://example.com/color.jpg?${key}=private`),
    `https://example.com/${'a'.repeat(4096)}`, 'https://example.com/a\nb.jpg', undefined,
  ];
  for (const imageUrl of unsafe) assert.throws(() => parseListing({ ...listing,
    colors: { status: 'observed', options: [{ ...option(oak, 'Oak'), imageUrl }] },
  }));
  const clean = parseListing({ ...listing, colors: { status: 'observed', options: [{ ...option(oak, 'Oak'), imageUrl: null, unexpected: 'discard' }] } });
  assert.equal(clean.colors?.options[0].imageUrl, null);
  assert.equal(Object.hasOwn(clean.colors!.options[0], 'unexpected'), false);
});
