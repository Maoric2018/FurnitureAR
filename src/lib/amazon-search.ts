import { ImportError } from './amazon';

export interface AmazonSearchProduct {
  asin: string;
  title: string;
  url: string;
  imageUrl: string | null;
  price: { amount: number; currency: string; display: string | null } | null;
  rating: number | null;
  ratingsTotal: number | null;
  availability: string | null;
  modelAvailable: boolean;
}

export interface AmazonSearchResults {
  query: string;
  page: number;
  nextPage: number | null;
  totalResults: number | null;
  products: AmazonSearchProduct[];
  retrievedAt: string;
  providerRetrievedAt: string | null;
  cached: boolean;
}

const invalidResults = () => new ImportError('Amazon search returned incomplete results. Please try again.', 'INVALID_SEARCH_RESULTS');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const boundedText = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit && !!value.trim() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const validPage = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10;
const timestamp = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const credentialName = /^(?:api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|auth|authorization|password|secret|client[_-]?secret|credential|signature|sig|x-amz-(?:credential|signature|security-token))$/i;

function safeImage(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
      && ![...url.searchParams.keys()].some(key => credentialName.test(key));
  } catch { return false; }
}

function searchQuery(value: unknown): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ImportError('Enter a search between 2 and 200 characters.', 'INVALID_QUERY');
  }
  const query = value.trim().replace(/\s+/g, ' ');
  if (query.length < 2 || query.length > 200) throw new ImportError('Enter a search between 2 and 200 characters.', 'INVALID_QUERY');
  return query;
}

export function parseAmazonSearchResults(value: unknown): AmazonSearchResults {
  if (!record(value) || !boundedText(value.query, 200) || value.query.trim().length < 2 || /[\u0000-\u001f\u007f]/.test(value.query)
      || !validPage(value.page) || (value.nextPage !== null && (!validPage(value.nextPage) || value.nextPage <= value.page))
      || (value.totalResults !== null && !count(value.totalResults))
      || !Array.isArray(value.products) || value.products.length > 100
      || !timestamp(value.retrievedAt) || (value.providerRetrievedAt !== null && !timestamp(value.providerRetrievedAt))
      || typeof value.cached !== 'boolean') throw invalidResults();

  const seen = new Set<string>();
  const products = value.products.map((item: unknown): AmazonSearchProduct => {
    if (!record(item) || typeof item.asin !== 'string' || !/^[A-Z0-9]{10}$/.test(item.asin) || seen.has(item.asin)
        || !boundedText(item.title, 2000) || item.url !== `https://www.amazon.com/dp/${item.asin}`
        || (item.imageUrl !== null && !safeImage(item.imageUrl))
        || (item.rating !== null && (typeof item.rating !== 'number' || !Number.isFinite(item.rating) || item.rating < 0 || item.rating > 5))
        || (item.ratingsTotal !== null && !count(item.ratingsTotal))
        || (item.availability !== null && !boundedText(item.availability, 1000))
        || typeof item.modelAvailable !== 'boolean') throw invalidResults();

    let price: AmazonSearchProduct['price'] = null;
    if (item.price !== null) {
      const raw = item.price;
      if (!record(raw) || typeof raw.amount !== 'number' || !Number.isFinite(raw.amount) || raw.amount < 0 || raw.amount > 1e12
          || typeof raw.currency !== 'string' || !/^[A-Z]{3}$/.test(raw.currency)
          || (raw.display !== null && !boundedText(raw.display, 200))) throw invalidResults();
      price = { amount: raw.amount, currency: raw.currency, display: raw.display };
    }
    seen.add(item.asin);
    return {
      asin: item.asin, title: item.title, url: item.url, imageUrl: item.imageUrl, price,
      rating: item.rating, ratingsTotal: item.ratingsTotal, availability: item.availability,
      modelAvailable: item.modelAvailable,
    };
  });
  return {
    query: value.query, page: value.page, nextPage: value.nextPage, totalResults: value.totalResults,
    products, retrievedAt: value.retrievedAt, providerRetrievedAt: value.providerRetrievedAt, cached: value.cached,
  };
}

const errorMessages: Record<string, string> = {
  SIGN_IN_REQUIRED: 'Sign in to search Amazon products. Your layouts stay on this device.',
  INVALID_QUERY: 'Enter a search between 2 and 200 characters.',
  INVALID_PAGE: 'Choose a search page between 1 and 10.',
  INVALID_SEARCH: 'Enter a search between 2 and 200 characters and a page from 1 to 10.',
  RATE_LIMITED: 'Please wait a minute before searching again.',
  LOOKUP_BUSY: 'A few searches are loading. Try again shortly.',
  SEARCH_BUSY: 'A few searches are loading. Try again shortly.',
  SERPAPI_NOT_CONFIGURED: 'Amazon search is not configured yet. Please contact the app owner.',
  SERPAPI_AUTH_FAILED: 'Amazon search is temporarily unavailable. Please contact the app owner.',
  SERPAPI_QUOTA_EXCEEDED: 'The Amazon search allowance has been reached. Please try again later.',
  SERPAPI_PROCESSING: 'Amazon is still preparing the results. Try again shortly.',
  SERPAPI_TIMEOUT: 'Amazon search took too long. Please try again.',
  SERPAPI_UNAVAILABLE: 'Could not reach Amazon search. Please try again shortly.',
};

function serviceError(status: number, data: unknown): ImportError {
  const rawCode = record(data) && record(data.error) ? data.error.code : null;
  const code = status === 401 ? 'SIGN_IN_REQUIRED'
    : typeof rawCode === 'string' && Object.hasOwn(errorMessages, rawCode) ? rawCode
    : status === 429 ? 'RATE_LIMITED' : 'SEARCH_FAILED';
  return new ImportError(errorMessages[code] || 'Amazon search is unavailable. Please try again shortly.', code);
}

async function readResponse(response: Response): Promise<unknown> {
  const maxBytes = 1_000_000;
  if (Number(response.headers.get('Content-Length')) > maxBytes) throw invalidResults();
  if (!response.body) throw invalidResults();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw invalidResults(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function searchAmazonProducts(q: string, page = 1, signal?: AbortSignal): Promise<AmazonSearchResults> {
  signal?.throwIfAborted();
  const query = searchQuery(q);
  if (!validPage(page)) throw new ImportError(errorMessages.INVALID_PAGE, 'INVALID_PAGE');
  let response: Response;
  try {
    response = await fetch(import.meta.env?.VITE_PRODUCT_SEARCH_API_URL || '/api/products/search', {
      method: 'POST', credentials: 'same-origin', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: query, page }), signal,
    });
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ImportError('Could not reach Amazon search. Check your connection and try again.', 'SEARCH_UNAVAILABLE');
  }
  let data: unknown;
  try { data = await readResponse(response); }
  catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.name === 'AbortError') throw error;
    if (!response.ok) throw serviceError(response.status, null);
    throw invalidResults();
  }
  signal?.throwIfAborted();
  if (!response.ok) throw serviceError(response.status, data);
  const results = parseAmazonSearchResults(data);
  if (results.query !== query || results.page !== page) throw invalidResults();
  return results;
}
