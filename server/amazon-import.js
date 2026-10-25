import { SerpApiClient } from './partner/serpapi.js';
import { normalizeSerpProduct } from './partner/serp-normalize.js';
import { ApiError } from './partner/errors.js';
import { resolveAmazonColors } from './amazon-colors.js';
import { placeholderProduct } from '../src/lib/workspace.ts';

const models = {
  B0F2ML48Y6: {
    id: 'little-tree-oak-table', category: 'Tables', footprint: 'ellipse',
    dimensions: { width: 1.199896, height: .750062, depth: 1.199896 },
    material: 'Oak finish', background: '#e9dfd0',
    variants: [{ id: 'oak', name: 'Oak', color: '#b68d5d', modelSrc: '/models/little-tree-oak-table.glb' }],
    note: 'Approximate reconstruction. The model is about 120 cm across and 75 cm high; confirm the selected size on Amazon.',
  },
  B0C4DGFFCM: {
    id: 'ambimall-floor-lamp', category: 'Lighting', footprint: 'rectangle',
    dimensions: { width: .5319242, height: 1.524, depth: .4306782 },
    material: 'Beige shade · black stand', background: '#eee9df',
    variants: [{ id: 'beige-black', name: 'Beige and black', color: '#c8b99f', modelSrc: '/models/ambimall-floor-lamp.glb' }],
    note: 'Approximate 60-inch model. Its footprint includes the cord. The listing may report a different height; check the selected size before buying.',
  },
};

const tableFinishes = new Map([
  ['B0F2ML48Y6', 'Oak'], ['B0D8P23H61', 'Black'], ['B0D8P1SVLG', 'Grey'],
  ['B0D8NSXYQ6', 'Light Brown'], ['B0F2MJHXBC', 'Rustic Brown'],
  ['B0DSZGP1HK', 'White'], ['B0D8NQHBBH', 'Brown'],
]);

export function hasRegisteredModel(asin) {
  return typeof asin === 'string' && (Object.hasOwn(models, asin) || tableFinishes.has(asin));
}

function tableModel(asin, colors) {
  const name = tableFinishes.get(asin);
  if (!name) return null;
  const original = models.B0F2ML48Y6;
  const finish = placeholderProduct.variants.find(variant => variant.name === name);
  const selected = { ...finish, id: asin, asin, productUrl: `https://www.amazon.com/dp/${asin}` };
  const model = { ...original, material: `${name} finish`, variants: [selected],
    note: `${original.note} Alternate finishes are approximate solid-color previews.` };
  if (colors.status !== 'observed') return model;
  const variants = colors.options.flatMap(option => {
    const expectedName = tableFinishes.get(option.asin);
    if (!expectedName || expectedName.toLowerCase() !== option.name.toLowerCase()) return [];
    const palette = placeholderProduct.variants.find(variant => variant.name === expectedName);
    return palette ? [{ ...palette, id: option.asin, asin: option.asin, name: option.name, productUrl: option.url,
      ...(palette.materialOverrides ? { materialOverrides: palette.materialOverrides.map(override => ({ ...override })) } : {}) }] : [];
  });
  // The known model geometry stays unchanged. An unverified option cannot
  // introduce a new material, model, size, or style.
  return variants.some(variant => variant.asin === asin) ? { ...model, variants } : model;
}

function otherModel(asin, colors) {
  const model = models[asin];
  if (!model) return null;
  const selected = colors.options.find(option => option.asin === asin);
  return { ...model, variants: model.variants.map(variant => ({ ...variant, asin,
    productUrl: `https://www.amazon.com/dp/${asin}`, name: selected?.name ?? variant.name })) };
}

export function parseAmazonLink(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f]/.test(value.trim())) {
    throw new ApiError(400, 'INVALID_LINK', 'Paste a full Amazon.com product link.');
  }
  const raw = value.trim();
  if (/^[a-z0-9]{10}$/i.test(raw)) return raw.toUpperCase();
  let url;
  try { url = new URL(raw.startsWith('https://') ? raw : `https://${raw}`); }
  catch { throw new ApiError(400, 'INVALID_LINK', 'Paste a full Amazon.com product link.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new ApiError(400, 'INVALID_LINK', 'Use a secure Amazon.com product link.');
  if (['a.co', 'amzn.to'].includes(url.hostname)) throw new ApiError(400, 'SHORT_LINK', 'Open the short link in your browser, then copy the full Amazon.com product address.');
  if (!['amazon.com', 'www.amazon.com', 'm.amazon.com', 'smile.amazon.com'].includes(url.hostname)) throw new ApiError(400, 'UNSUPPORTED_STORE', 'Amazon.com links are supported right now.');
  const match = url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([a-z0-9]{10})(?:\/|$)/i);
  if (!match) throw new ApiError(400, 'INVALID_LINK', 'Copy the product’s Amazon.com address, including /dp/ and its product ID.');
  return match[1].toUpperCase();
}

export function normalizeImport(data, requestedAsin, now = new Date()) {
  if (!data?.product_results || typeof data.product_results !== 'object' || Array.isArray(data.product_results)) {
    throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'We couldn’t find this product on Amazon. Check the link and try again.');
  }
  const identities = [data.product_results.asin, data.product_details?.asin]
    .filter(value => typeof value === 'string' && /^[a-z0-9]{10}$/i.test(value)).map(value => value.toUpperCase());
  if (!identities.length || identities.some(value => value !== requestedAsin)) {
    throw new ApiError(502, 'PRODUCT_MISMATCH', 'Amazon returned a different product variant. Try the link for the exact size and finish.');
  }
  const source = normalizeSerpProduct(data, requestedAsin);
  if (!source.title) throw new ApiError(502, 'INCOMPLETE_PRODUCT', 'Amazon returned incomplete product details. Try again shortly.');
  let colors = resolveAmazonColors(data.product_results, requestedAsin, data.product_details?.color ?? data.item_specifications?.color);
  const suppliedColors = [data.product_details?.color, data.item_specifications?.color].filter(value => value !== undefined && value !== null);
  if (suppliedColors.some(value => typeof value !== 'string')
      || new Set(suppliedColors.map(value => typeof value === 'string' ? value.trim().toLowerCase() : value)).size > 1) {
    colors = { status: 'unconfirmed', options: [] };
  }
  const expectedFinish = tableFinishes.get(requestedAsin);
  const observedFinish = colors.options.find(option => option.selected)?.name;
  if (expectedFinish && observedFinish && expectedFinish.toLowerCase() !== observedFinish.toLowerCase()) {
    colors = { status: 'unconfirmed', options: [] };
  }
  const registered = tableModel(requestedAsin, colors) ?? otherModel(requestedAsin, colors);
  const listing = {
    asin: requestedAsin, title: source.title, brand: source.brand,
    url: `https://www.amazon.com/dp/${requestedAsin}`,
    images: source.images.map(image => image.url).slice(0, 8),
    price: source.price, availability: source.availability, colors,
    features: source.features.slice(0, 8), dimensionText: source.dimensionText,
    dimensions: source.dimensions ? {
      width: source.dimensions.meters.width, depth: source.dimensions.meters.length,
      height: source.dimensions.meters.height,
    } : null,
    retrievedAt: now.toISOString(), modelNote: registered?.note ?? null,
  };
  // Model dimensions describe the supplied geometry. Listing measurements are
  // retained separately, including unknown or conflicting fields.
  const product = registered ? {
    ...registered, name: listing.title, tagline: listing.brand || 'Amazon product',
    description: listing.features[0] || registered.note,
  } : null;
  return { listing, product };
}

export function createImporter(env, fetchImpl = fetch) {
  const client = new SerpApiClient({ serpApiKey: env.SERPAPI_API_KEY || '', serpNoCache: false, serpTimeoutMs: 60000 }, { fetchImpl });
  return async asin => normalizeImport(await client.get(asin), asin);
}
