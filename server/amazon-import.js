import { SerpApiClient } from './partner/serpapi.js';
import { normalizeSerpProduct } from './partner/serp-normalize.js';
import { ApiError } from './partner/errors.js';

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
  const registered = models[requestedAsin];
  const listing = {
    asin: requestedAsin, title: source.title, brand: source.brand,
    url: `https://www.amazon.com/dp/${requestedAsin}`,
    images: source.images.map(image => image.url).slice(0, 8),
    price: source.price, availability: source.availability,
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
