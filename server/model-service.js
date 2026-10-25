import { validateGeneratedModel } from './generated-model-validation.js';
export { validateGeneratedModel } from './generated-model-validation.js';
import { createImporter } from './amazon-import.js';
import { ApiError } from './partner/errors.js';
import { modelGenerator } from './model-generator.js';
import { parseListing } from '../src/lib/amazon.ts';
import { parseProduct } from '../src/lib/products.ts';

const HOUR = 3600000;
const POLL_MS = 3000;
const MAX_METADATA_BYTES = 256 * 1024;
const root = asin => `generated-models/amazon-com/${asin}`;
const canonicalUrl = asin => `https://www.amazon.com/dp/${asin}`;
const validAsin = value => typeof value === 'string' && /^[A-Z0-9]{10}$/.test(value);
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const cleanText = (value, fallback, max = 200) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;

function imageUrl(listing) {
  return listing.images?.find(value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port
        && /(^|\.)(media-amazon\.com|ssl-images-amazon\.com|images-amazon\.com)$/i.test(url.hostname);
    } catch { return false; }
  }) ?? null;
}


function publicValue(record, cached = false) {
  const model = { status: record.status };
  if (record.status === 'ready') model.source = cached ? 'cache' : record.source;
  if (record.status === 'pending') {
    model.retryAfterMs = POLL_MS;
    if (['preparing', 'reconstructing', 'texturing', 'exporting'].includes(record.stage)) model.stage = record.stage;
  }
  return { listing: record.listing, product: record.status === 'ready' ? record.product : null, model, cached };
}

function generatedProduct(listing, result, hash) {
  const asin = listing.asin;
  const selectedColor = listing.colors?.options?.find(option => option.asin === asin);
  return {
    id: `amazon-${asin.toLowerCase()}`, name: listing.title,
    category: ['Seating', 'Tables', 'Lighting', 'Storage'].includes(result.category) ? result.category : 'Storage',
    tagline: listing.brand || 'Amazon product', description: listing.features?.[0] || 'Generated from the Amazon product image. Verify its appearance and measurements before buying.',
    dimensions: { width: result.dimensions.width, height: result.dimensions.height, depth: result.dimensions.depth },
    ...(result.scaleReference ? { scaleReference: result.scaleReference } : {}),
    material: cleanText(result.material, 'Generated product appearance'), background: '#e9ede5', footprint: 'rectangle',
    variants: [{ id: asin, asin, productUrl: canonicalUrl(asin),
      name: cleanText(selectedColor?.name, cleanText(result.colorName, 'Original appearance')),
      color: typeof result.color === 'string' && /^#[0-9a-f]{6}$/i.test(result.color) ? result.color : '#b7b4ad',
      modelSrc: `/api/products/models/${asin}/${hash}.glb`, approximate: true }],
  };
}

export function createModelService({ lookup, generator = modelGenerator, now = Date.now, adapterTimeoutMs = 15000 } = {}) {
  const listingCache = new Map(), inFlight = new Map();
  let importer, apiKey;
  const version = cleanText(generator.version, 'unversioned', 100);
  const timeoutMs = Math.min(60000, Math.max(1, adapterTimeoutMs));
  const remember = (asin, value) => {
    if (listingCache.size >= 100) listingCache.delete(listingCache.keys().next().value);
    listingCache.set(asin, { value, expires: now() + HOUR });
  };
  const envelope = (asin, value, status) => ({ schemaVersion: 1, asin, url: canonicalUrl(asin),
    listing: value.listing, product: value.product ?? null, status, generatorVersion: version,
    createdAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString(), metadataExpiresAt: now() + HOUR });

  async function readRecord(bucket, asin) {
    const object = await bucket.get(`${root(asin)}/metadata.json`);
    if (!object) return null;
    if (object.size > MAX_METADATA_BYTES) throw new Error('Invalid stored metadata.');
    const text = await object.text();
    if (text.length > MAX_METADATA_BYTES) throw new Error('Invalid stored metadata.');
    let record;
    try {
      record = JSON.parse(text);
      if (record.schemaVersion !== 1 || record.asin !== asin || record.url !== canonicalUrl(asin)
        || record.listing?.asin !== asin || record.listing?.url !== canonicalUrl(asin)) throw new Error('Stored product identity mismatch.');
      if (!['ready', 'pending', 'not_configured', 'no_image', 'failed'].includes(record.status)) throw new Error('Invalid stored status.');
      record.listing = parseListing(record.listing);
      if (record.status === 'ready') {
        record.product = parseProduct(record.product);
        if (!record.product.variants.some(variant => variant.asin === asin)) throw new Error('Stored model identity mismatch.');
        if (record.source === 'generated') {
          if (!validHash(record.hash) || record.product.variants.length !== 1
            || record.product.variants[0].productUrl !== canonicalUrl(asin)
            || record.product.variants[0].modelSrc !== `/api/products/models/${asin}/${record.hash}.glb`) throw new Error('Stored model identity mismatch.');
        } else if (record.source !== 'registered') throw new Error('Invalid model source.');
      }
    } catch { return { corrupt: true, _etag: object.etag }; }
    // A transient storage failure must never be mistaken for corrupt metadata
    // and overwrite a previously ready record.
    if (record.status === 'ready' && record.source === 'generated'
        && !(await bucket.head(`${root(asin)}/${record.hash}.glb`))) return { corrupt: true, _etag: object.etag };
    return { ...record, _etag: object.etag };
  }
  async function writeRecord(bucket, record, previous = null) {
    record.updatedAt = new Date(now()).toISOString();
    const { _etag, ...stored } = record;
    const result = await bucket.put(`${root(record.asin)}/metadata.json`, JSON.stringify(stored), {
      httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
      customMetadata: { asin: record.asin, amazonUrl: record.url, generatorVersion: record.generatorVersion },
      onlyIf: previous?._etag ? { etagMatches: previous._etag } : { etagDoesNotMatch: '*' },
    });
    if (!result) {
      const current = await readRecord(bucket, record.asin);
      if (!current || current.corrupt) throw new Error('Concurrent metadata update.');
      return { record: current, conflict: true };
    }
    return { record: { ...record, _etag: result.etag }, conflict: false };
  }
  async function lookupListing(asin, env) {
    const cached = listingCache.get(asin);
    if (cached && cached.expires > now()) return { value: cached.value, cached: true };
    if (!lookup && (!importer || apiKey !== env.SERPAPI_API_KEY)) { apiKey = env.SERPAPI_API_KEY; importer = createImporter(env); }
    const value = await (lookup || importer)(asin);
    if (value?.listing?.asin !== asin || value.listing.url !== canonicalUrl(asin)) throw new ApiError(502, 'PRODUCT_MISMATCH', 'Amazon returned a different product variant. Try the exact product link.');
    remember(asin, value);
    return { value, cached: false };
  }

  async function resolve(asin, env, statusOnly) {
    const bucket = env.MODEL_BUCKET;
    let record = null, corruptRecord = null, storageAvailable = Boolean(bucket), cached = false;
    if (bucket) {
      try { record = await readRecord(bucket, asin); cached = Boolean(record); }
      catch { storageAvailable = false; }
    }
    if (record?.corrupt) { corruptRecord = record; record = null; cached = false; }
    if (record?.status === 'ready') return publicValue(record, true);
    if (statusOnly && !storageAvailable) throw new ApiError(503, 'MODEL_STORAGE_UNAVAILABLE', 'Saved models are temporarily unavailable. Try again shortly.');
    if (statusOnly && !record) throw new ApiError(404, 'MODEL_NOT_FOUND', 'Select this Amazon product first to prepare its model.');

    const fresh = record && record.metadataExpiresAt > now();
    // A pending job keeps its original listing and image throughout generation.
    // Fresh listing snapshots also survive adapter upgrades without another
    // SerpApi request. Only ready geometry is reused indefinitely.
    let value;
    if (record && (fresh || record.status === 'pending' || statusOnly)) value = { listing: record.listing, product: record.product };
    else { const loaded = await lookupListing(asin, env); value = loaded.value; cached = loaded.cached; }
    if (value.product) {
      const registered = { ...envelope(asin, value, 'ready'), source: 'registered' };
      if (storageAvailable) { try {
        const written = await writeRecord(bucket, registered, record ?? corruptRecord);
        if (written.conflict) return publicValue(written.record, true);
      } catch { /* Registered assets already exist in the deployment. */ } }
      return publicValue(registered, cached);
    }
    if (!storageAvailable) return publicValue(envelope(asin, value, 'storage_unavailable'), cached);
    if (fresh && record.generatorVersion === version && ['not_configured', 'no_image'].includes(record.status)
      && !(record.status === 'not_configured' && env.MODEL_API_URL && env.MODEL_API_KEY)) return publicValue(record, true);

    const input = { asin, url: canonicalUrl(asin), imageUrl: imageUrl(value.listing), listing: value.listing,
      idempotencyKey: `furniture-ar:amazon-com:${asin}:${version}` };
    const next = { ...envelope(asin, value, 'pending'), createdAt: record?.createdAt ?? new Date(now()).toISOString(), imageUrl: input.imageUrl,
      idempotencyKey: input.idempotencyKey };
    if (!input.imageUrl) {
      next.status = 'no_image';
      try { const written = await writeRecord(bucket, next, record ?? corruptRecord); return publicValue(written.record, cached || written.conflict); }
      catch { return publicValue({ ...next, status: 'storage_unavailable' }, cached); }
    }

    // Persist the intent before requesting generation. The stable idempotency
    // key handles retries after a crash; adapters must pass it to their
    // provider. Conditional metadata writes provide a short lease and prevent
    // a delayed Worker from overwriting another Worker's ready result.
    const currentPending = record?.status === 'pending' && record.generatorVersion === version;
    const existingJob = currentPending && typeof record.jobId === 'string' && record.jobId.length > 0;
    if (currentPending && now() < Number(record.nextPollAt)) return publicValue(record, true);
    let intent;
    try {
      const claimed = await writeRecord(bucket, { ...(existingJob ? record : next), nextPollAt: now() + timeoutMs + POLL_MS }, record ?? corruptRecord);
      if (claimed.conflict) return publicValue(claimed.record, true);
      intent = claimed.record;
    }
    catch { return publicValue({ ...next, status: 'storage_unavailable' }, cached); }
    let result;
    const controller = new AbortController(); let timer;
    try {
      result = await Promise.race([
        Promise.resolve().then(() => existingJob ? generator.poll({ ...input, jobId: record.jobId, signal: controller.signal }, env) : generator.start({ ...input, signal: controller.signal }, env)),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Model adapter timed out.')); }, timeoutMs); }),
      ]);
    } catch { result = existingJob ? { status: 'pending', jobId: record.jobId, stage: record.stage } : { status: 'failed' }; }
    finally { clearTimeout(timer); }
    try {
      if (result?.status === 'ready') {
        const glb = validateGeneratedModel(result);
        const digest = await crypto.subtle.digest('SHA-256', glb);
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        // Bytes must be durable before a ready record can point at them.
        await bucket.put(`${root(asin)}/${hash}.glb`, glb, {
          httpMetadata: { contentType: 'model/gltf-binary', cacheControl: 'public, max-age=31536000, immutable' },
          customMetadata: { asin, amazonUrl: input.url },
        });
        const ready = { ...next, status: 'ready', source: 'generated', hash,
          listing: { ...next.listing, modelNote: result.scaleReference === 'preview'
            ? 'Approximate photo-generated model at a reference height of 1 m. This listing has no usable measurement, so AR and room placement are unavailable.'
            : `Approximate model generated from the product image.${result.scaleReference ? ` Scale uses the listed ${result.scaleReference}; other dimensions follow the reconstructed proportions.` : ''} Verify appearance and measurements before buying.` },
          product: generatedProduct(value.listing, result, hash) };
        const written = await writeRecord(bucket, ready, intent);
        return publicValue(written.record, cached || written.conflict);
      }
      if (result?.status === 'pending' && typeof result.jobId === 'string' && result.jobId.length > 0 && result.jobId.length <= 500) {
        Object.assign(next, { status: 'pending', jobId: result.jobId, stage: result.stage, nextPollAt: now() + POLL_MS });
      } else next.status = result?.status === 'not_configured' ? 'not_configured' : 'failed';
      const written = await writeRecord(bucket, next, intent);
      return publicValue(written.record, cached || written.conflict);
    } catch (error) {
      // A failed validation never becomes ready; a storage failure also leaves
      // no ready metadata. Neither path leaks provider diagnostics or job IDs.
      if (result?.status === 'ready') {
        try { validateGeneratedModel(result); }
        catch {
          try { const written = await writeRecord(bucket, { ...next, status: 'failed' }, intent); return publicValue(written.record, cached || written.conflict); }
          catch { return publicValue({ ...next, status: 'storage_unavailable' }, cached); }
        }
      }
      return publicValue({ ...next, status: 'storage_unavailable' }, cached);
    }
  }

  async function load(asin, env = {}, statusOnly = false) {
    if (!validAsin(asin)) throw new ApiError(400, 'INVALID_LINK', 'Use a valid Amazon product ID.');
    if (!inFlight.has(asin)) {
      if (inFlight.size >= 4) throw new ApiError(503, 'LOOKUP_BUSY', 'A few products are loading. Try again shortly.', 2);
      const work = resolve(asin, env, statusOnly).finally(() => inFlight.delete(asin));
      inFlight.set(asin, work);
    }
    return inFlight.get(asin);
  }

  async function asset(request, env, asin, hash) {
    const headers = { 'X-Content-Type-Options': 'nosniff' };
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
    if (!validAsin(asin) || !validHash(hash) || !env.MODEL_BUCKET) return new Response(null, { status: 404, headers });
    try {
      const key = `${root(asin)}/${hash}.glb`;
      const object = request.method === 'HEAD' ? await env.MODEL_BUCKET.head(key) : await env.MODEL_BUCKET.get(key);
      if (!object) return new Response(null, { status: 404, headers });
      return new Response(request.method === 'HEAD' ? null : object.body, { headers: { ...headers,
        'Content-Type': 'model/gltf-binary', 'Content-Length': String(object.size),
        'Cache-Control': 'public, max-age=31536000, immutable', ETag: `"${hash}"` } });
    } catch { return new Response(null, { status: 503, headers: { ...headers, 'Retry-After': '3', 'Cache-Control': 'no-store' } }); }
  }
  return { load, asset };
}
