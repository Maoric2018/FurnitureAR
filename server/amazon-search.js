import { SerpApiClient } from './partner/serpapi.js';
import { normalizeSerpSearchItem } from './partner/serp-normalize.js';
import { ApiError } from './partner/errors.js';
import { hasRegisteredModel } from './amazon-import.js';

const invalidSearch = () => new ApiError(400, 'INVALID_SEARCH', 'Enter a search between 2 and 200 characters and a page from 1 to 10.');
const badResponse = () => new ApiError(502, 'SERPAPI_BAD_RESPONSE', 'Amazon returned incomplete search results. Please try again shortly.');
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const boundedText = (value, limit) => typeof value === 'string' && value.length <= limit && value.trim()
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ? value : null;
const credentialName = /^(?:api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|auth|authorization|password|secret|client[_-]?secret|credential|signature|sig|x-amz-(?:credential|signature|security-token))$/i;

export function parseSearchRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.q !== 'string'
    || /[\u0000-\u001f\u007f-\u009f]/.test(body.q)) throw invalidSearch();
  const q = body.q.trim().replace(/\s+/gu, ' ');
  const page = body.page === undefined ? 1 : body.page;
  if (q.length < 2 || q.length > 200 || !Number.isInteger(page) || page < 1 || page > 10) throw invalidSearch();
  return { q, page };
}

function providerDate(value) {
  if (typeof value !== 'string') return null;
  // SerpApi timestamps use UTC, while fixtures and future responses may use ISO.
  const timestamp = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC$/.test(value)
    ? value.replace(' ', 'T').replace(' UTC', 'Z') : value;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(timestamp)) return null;
  const milliseconds = Date.parse(timestamp);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function imageUrl(images) {
  // The partner normalizer already rejects non-HTTPS and credential-bearing
  // query parameters. Fragments do not affect image requests and are omitted.
  const value = images[0]?.url;
  if (!value || value.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  const url = new URL(value);
  if ([...url.searchParams.keys()].some(key => credentialName.test(key))) return null;
  url.hash = '';
  return url.toString();
}

/** Search summaries never imply stock, dimensions, or an unregistered 3D model. */
export function normalizeSearch(data, input, now = new Date()) {
  const { q, page } = parseSearchRequest(input);
  const totalResults = count(data?.search_information?.total_results);
  const explicitlyEmpty = data?.search_metadata?.status === 'Success' && totalResults === 0
    && (data.organic_results === undefined || (Array.isArray(data.organic_results) && data.organic_results.length === 0));
  if (!data || typeof data !== 'object' || Array.isArray(data) || (data.error && !explicitlyEmpty)
    || (data.search_metadata?.status && data.search_metadata.status !== 'Success')
    || (data.search_parameters?.amazon_domain && data.search_parameters.amazon_domain !== 'amazon.com')) throw badResponse();
  // Empty is valid only when the provider explicitly returns an empty result
  // list or zero total. Missing/malformed data is an error, not "no products".
  if (!Array.isArray(data.organic_results)
    && (data.organic_results !== undefined || totalResults !== 0)) throw badResponse();
  const raw = data.organic_results ?? [];
  const seen = new Set(), products = [];
  for (const item of raw) {
    const product = normalizeSerpSearchItem(item);
    if (!product.asin || !boundedText(product.title, 2000) || seen.has(product.asin)) continue;
    seen.add(product.asin);
    products.push({
      asin: product.asin, title: product.title, url: product.productUrl,
      imageUrl: imageUrl(product.images), price: product.price && product.price.amount <= 1e12
        ? { ...product.price, display: boundedText(product.price.display, 200) } : null,
      rating: typeof item.rating === 'number' && Number.isFinite(item.rating) && item.rating >= 0 && item.rating <= 5 ? item.rating : null,
      ratingsTotal: count(item.reviews), availability: boundedText(product.availability, 1000),
      modelAvailable: hasRegisteredModel(product.asin),
    });
    if (products.length === 100) break;
  }
  if (raw.length && !products.length) throw badResponse();
  // Never return or follow the pagination URL: it may contain the private key.
  const next = [data.pagination?.next, data.serpapi_pagination?.next].some(value => typeof value === 'string' && value.trim());
  return {
    query: q, page, nextPage: next && page < 10 ? page + 1 : null,
    totalResults, products, retrievedAt: now.toISOString(),
    providerRetrievedAt: providerDate(data.search_metadata?.processed_at) ?? providerDate(data.search_metadata?.created_at),
    cached: false,
  };
}

export function createSearcher(env, fetchImpl = fetch) {
  const client = new SerpApiClient({ serpApiKey: env.SERPAPI_API_KEY || '', serpNoCache: false, serpTimeoutMs: 60000 }, { fetchImpl });
  return async input => {
    const search = parseSearchRequest(input);
    return normalizeSearch(await client.search(search), search);
  };
}
