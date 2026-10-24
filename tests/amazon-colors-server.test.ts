import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImport } from '../server/amazon-import.js';
import { resolveAmazonColors } from '../server/amazon-colors.js';
import { adaptAmazonProduct } from '../server/external-amazon-bridge.ts';
import { normalizeSerpVariants } from '../server/partner/serp-variants.js';
import { parseListing } from '../src/lib/amazon.ts';

const oak = 'B0F2ML48Y6', black = 'B0D8P23H61', white = 'B0DSZGP1HK', blue = 'B012345678';
const unconfirmed = { status: 'unconfirmed', options: [] };
const group = (items: object[], title = 'Color') => ({ title, items });
const colors = () => [
  { name: 'Oak', asin: oak, selected: true, image: 'https://m.media-amazon.com/oak.jpg' },
  { name: 'Black', asin: black }, { name: 'White', asin: white },
];
const product = (extra: object = {}) => ({ asin: oak, title: 'Table', variants: [group(colors())], ...extra });
const combination = (asin: string | undefined, color: string, size = '47 inches', style = 'Round', extra: object = {}) =>
  ({ ...(asin ? { asin } : {}), dimensions: { color, size, style }, ...extra });

test('Color metadata is observed separately from known model and palette mappings', () => {
  const raw = product({ variants: [group([...colors(), { name: 'Ocean Blue', asin: blue }])] });
  const result = normalizeImport({ product_results: raw }, oak);
  assert.equal(result.listing.colors.status, 'observed');
  assert.deepEqual(result.listing.colors.options.map((option: { name: string }) => option.name), ['Oak', 'Black', 'White', 'Ocean Blue']);
  assert.deepEqual(result.product?.variants.map(variant => variant.name), ['Oak', 'Black', 'White']);
  assert.deepEqual(result.listing.colors.options.map((option: { selected: boolean }) => option.selected), [true, false, false, false]);
  assert.equal(result.listing.colors.options[1].url, `https://www.amazon.com/dp/${black}`);
});

test('Unknown products retain real color names without receiving invented AR geometry or RGB values', () => {
  const result = normalizeImport({ product_results: { asin: blue, title: 'Blue chair', variants: [group([
    { name: 'Ocean Blue', asin: blue, selected: true }, { name: 'Coral / multicolor', asin: 'B000DEMO01' },
  ])] } }, blue);
  assert.equal(result.product, null);
  assert.equal(result.listing.colors.status, 'observed');
  assert.deepEqual(result.listing.colors.options.map((option: { name: string }) => option.name), ['Ocean Blue', 'Coral / multicolor']);
  assert.equal('color' in result.listing.colors.options[1], false);
  assert.equal('modelSrc' in result.listing.colors.options[1], false);
});

test('Combinations retain the requested size and style even when direct swatches point to another size', () => {
  const raw = product({ variants: [group([colors()[0], { name: 'Black', asin: blue }, colors()[2]]),
    group([{ name: '47 inches', selected: true }, { name: '60 inches' }], 'Size'),
    group([{ name: 'Round', selected: true }, { name: 'Square' }], 'Style')],
  variant_combinations: [combination(oak, 'Oak'), combination(black, 'Black'),
    combination(blue, 'Black', '60 inches'), combination(white, 'White', '47 inches', 'Square')] });
  const resolved = resolveAmazonColors(raw, oak);
  assert.equal(resolved.status, 'observed');
  assert.deepEqual(resolved.options.map((option: { asin: string }) => option.asin), [oak, black]);
  assert.equal(resolved.options[1].url, `https://www.amazon.com/dp/${black}`);
});

test('Unavailable direct choices and unavailable combinations are excluded, including combinations with no ASIN', () => {
  for (const flag of [{ unavailable: true }, { available: false }]) {
    const direct = resolveAmazonColors(product({ variants: [group([colors()[0], { ...colors()[1], ...flag }])] }), oak);
    assert.equal(direct.status, 'observed');
    assert.deepEqual(direct.options.map((option: { asin: string }) => option.asin), [oak]);
  }
  const combined = resolveAmazonColors(product({ variant_combinations: [combination(oak, 'Oak'),
    combination(black, 'Black', undefined, undefined, { unavailable: true }),
    combination(undefined, 'White', undefined, undefined, { unavailable: true })] }), oak);
  assert.equal(combined.status, 'observed');
  assert.deepEqual(combined.options.map((option: { asin: string }) => option.asin), [oak]);
});

test('An unavailable requested choice retains only the independently mapped model appearance', () => {
  for (const extra of [
    { variants: [group([{ ...colors()[0], unavailable: true }, colors()[1]])] },
    { variant_combinations: [combination(oak, 'Oak', undefined, undefined, { unavailable: true }), combination(black, 'Black')] },
  ]) {
    const result = normalizeImport({ product_results: product(extra) }, oak);
    assert.deepEqual(result.listing.colors, unconfirmed);
    assert.deepEqual(result.product?.variants.map(variant => variant.asin), [oak]);
  }
});

test('Non-color axes need complete combination evidence before exposing alternatives', () => {
  const groups = [group(colors()), group([{ name: '47 inches', selected: true }], 'Size')];
  assert.deepEqual(resolveAmazonColors(product({ variants: groups }), oak), unconfirmed);
  assert.deepEqual(resolveAmazonColors(product({ variants: groups, variant_combinations: [
    { asin: oak, dimensions: { color: 'Oak' } }, { asin: black, dimensions: { color: 'Black' } },
  ] }), oak), unconfirmed);
  assert.deepEqual(resolveAmazonColors(product({ variants: groups, variant_combinations: [
    combination(oak, 'Oak', '60 inches'), combination(black, 'Black', '60 inches'),
  ] }), oak), unconfirmed);
});

test('Absent, malformed, duplicate, or identity-less metadata never creates selectable alternatives', () => {
  const invalid = [
    { variants: undefined }, { variants: [] }, { variants: 'bad' },
    { variants: [group(colors()), group(colors(), 'Colour')] },
    { variants: [group([colors()[0], { name: 'Black' }])] },
    { variants: [group([colors()[0], { name: 'Black', asin: 'INVALID' }])] },
    { variants: [group([colors()[0], { name: 'oak', asin: black }])] },
    { variants: [group([colors()[0], { name: 'Black', asin: oak }])] },
    { variants: [group([colors()[0], { name: 'Black', asin: black, selected: true }])] },
    { variants: [group([colors()[0], { name: 'Black', asin: black, unavailable: 'false' }])] },
    { variants: [group([colors()[0], { name: '\u0000Black', asin: black }])] },
    { variant_combinations: 'bad' },
    { variant_combinations: [combination(oak, 'Oak'), combination(undefined, 'Black')] },
    { variant_combinations: [combination(oak, 'Oak'), combination('INVALID', 'Black', undefined, undefined, { unavailable: true })] },
    { variant_combinations: [combination(oak, 'Oak'), combination(black, 'Black'), combination(blue, 'Black')] },
    { variant_combinations: [combination(oak, 'Oak'), combination(black, 'Black'), combination(black, 'Black', '60 inches')] },
  ];
  for (const extra of invalid) assert.deepEqual(resolveAmazonColors(product(extra), oak), unconfirmed, JSON.stringify(extra));
});

test('Contradictory current color labels fail closed instead of claiming a different mapped appearance', () => {
  assert.deepEqual(resolveAmazonColors(product(), oak, 'Black'), unconfirmed);
  const mismatch = normalizeImport({ product_results: product(), product_details: { color: 'Oak' }, item_specifications: { color: 'Black' } }, oak);
  assert.deepEqual(mismatch.listing.colors, unconfirmed);
  const wrongMapping = normalizeImport({ product_results: { asin: black, title: 'Table', variants: [group([{ name: 'Oak', asin: black }])] } }, black);
  assert.deepEqual(wrongMapping.listing.colors, unconfirmed);
  assert.equal(wrongMapping.product?.variants[0].name, 'Black');
});

test('Color images cannot expose unsafe URLs, credentials, or provider signatures', () => {
  for (const image of ['http://example.com/image.jpg', 'https://user:secret@example.com/image.jpg',
    'https://example.com/image.jpg?%61pi_key=secret', 'https://example.com/image.jpg?X-Amz-Signature=secret',
    'https://example.com/image.jpg#secret', 'https://example.com/\nimage.jpg',
    ...['key', 'password', 'auth', 'sig', 'refresh_token'].map(name => `https://example.com/image.jpg?${name}=secret`)]) {
    const result = normalizeImport({ product_results: product({ variants: [group([{ ...colors()[0], image }])] }) }, oak);
    const parsed = parseListing(result.listing);
    assert.equal(parsed.colors?.status, 'observed');
    assert.equal(parsed.colors?.options[0].imageUrl, null);
    assert.equal(parsed.colors?.options[0].url, `https://www.amazon.com/dp/${oak}`);
  }
});

test('The original lamp uses its observed Amazon name and exact ASIN, while other colors remain listing-only', () => {
  const asin = 'B0C4DGFFCM';
  const result = normalizeImport({ product_results: { asin, title: 'Lamp', variants: [group([
    { name: 'Beige & Black', asin, selected: true }, { name: 'White & Black', asin: 'B0DBHRNVR6' },
  ])] } }, asin);
  assert.equal(result.listing.colors.options.length, 2);
  assert.equal(result.product?.variants.length, 1);
  assert.equal(result.product?.variants[0].name, 'Beige & Black');
  assert.equal(result.product?.variants[0].asin, asin);
  assert.equal(result.product?.variants[0].productUrl, `https://www.amazon.com/dp/${asin}`);
});

test('The external normalized bridge also honors direct unavailability and rejects unproven size changes', () => {
  const normalized = normalizeSerpVariants(product({ variants: [group([colors()[0], { ...colors()[1], unavailable: true }])] }));
  const raw = { source: 'serpapi', product: { asin: oak, title: 'Table', dimensions: { complete: true, meters: { width: 1.2, length: 1.2, height: .75 } }, ...normalized } };
  assert.deepEqual(adaptAmazonProduct(raw, oak).variants.map(variant => variant.asin), [oak]);
  assert.throws(() => adaptAmazonProduct({ ...raw, product: { ...raw.product, variantGroups: [...normalized.variantGroups,
    { title: 'Size', kind: 'other', options: [{ label: '47 inches', selected: true }] }] } }, oak), /selected size and style/);
});
