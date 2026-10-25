import { ApiError } from './errors.js';

const SORTS = {
  Relevance: 'relevanceblender', Featured: 'relevanceblender',
  'Price:LowToHigh': 'price-asc-rank', 'Price:HighToLow': 'price-desc-rank',
  AvgCustomerReviews: 'review-rank', NewestArrivals: 'date-desc-rank',
};

/** Direct SerpApi transport. URLs contain the API key, so never log URLs/errors from fetch. */
export class SerpApiClient {
  constructor(config, { fetchImpl = fetch } = {}) {
    this.config = config;
    // Worker fetch rejects a class instance as its receiver; Node's fetch does not.
    this.fetch = (...args) => fetchImpl.call(globalThis, ...args);
    this.inFlight = new Map();
  }

  request(parameters) {
    const identity = JSON.stringify(parameters);
    if (this.inFlight.has(identity)) return this.inFlight.get(identity);
    if (this.inFlight.size >= 4) return Promise.reject(new ApiError(503, 'LOOKUP_BUSY', 'Four lookups are already running. Try again shortly.', 2));
    const promise = this.perform(parameters).finally(() => this.inFlight.delete(identity));
    this.inFlight.set(identity, promise);
    return promise;
  }

  async perform(parameters) {
    if (!this.config.serpApiKey) throw new ApiError(503, 'SERPAPI_NOT_CONFIGURED', 'Set SERPAPI_API_KEY on the server to enable live lookups.');
    const url = new URL('https://serpapi.com/search.json');
    for (const [key, value] of Object.entries({
      ...parameters, amazon_domain: 'amazon.com', language: 'en_US',
      api_key: this.config.serpApiKey, output: 'json',
      no_cache: this.config.serpNoCache ? 'true' : undefined,
    })) if (value !== undefined) url.searchParams.set(key, String(value));
    try {
      const response = await this.fetch(url, {
        method: 'GET', headers: { Accept: 'application/json' }, redirect: 'manual',
        signal: AbortSignal.timeout(this.config.serpTimeoutMs),
      });
      let bytes = 0;
      const chunks = [];
      const reader = response.body?.getReader();
      if (reader) while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 5_000_000) { await reader.cancel(); throw new ApiError(502, 'SERPAPI_BAD_RESPONSE', 'SerpApi returned an oversized response.'); }
        chunks.push(Buffer.from(value));
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { data = null; }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new ApiError(502, 'SERPAPI_AUTH_FAILED', 'SerpApi rejected the API key or account access. Check your local configuration and SerpApi dashboard.');
        if (response.status === 429) {
          const retry = Number(response.headers.get('retry-after'));
          throw new ApiError(503, 'SERPAPI_QUOTA_EXCEEDED', 'SerpApi quota or hourly limit reached. Check your account allowance before retrying.', Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : null);
        }
        throw new ApiError(502, 'SERPAPI_REQUEST_FAILED', 'SerpApi could not complete this lookup. Try again later.');
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError(502, 'SERPAPI_BAD_RESPONSE', 'SerpApi returned invalid JSON data.');
      const status = data.search_metadata?.status;
      if (status === 'Processing') throw new ApiError(503, 'SERPAPI_PROCESSING', 'SerpApi has not completed the lookup. Try again shortly.', 2);
      if (status === 'Error' || (data.error && status !== 'Success')) throw new ApiError(502, 'SERPAPI_REQUEST_FAILED', 'SerpApi could not retrieve this Amazon page.');
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (['AbortError', 'TimeoutError'].includes(error.name)) throw new ApiError(504, 'SERPAPI_TIMEOUT', 'The Amazon lookup through SerpApi timed out. Try again later.');
      throw new ApiError(502, 'SERPAPI_UNAVAILABLE', 'Could not reach SerpApi. Check the network and try again.');
    }
  }

  get(asin) { return this.request({ engine: 'amazon_product', asin }); }
  search({ q, page, sort, rh }) { return this.request({ engine: 'amazon', k: q, page, s: SORTS[sort], rh }); }
}
