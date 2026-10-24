import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseProduct } from '../src/lib/products';
import type { FurnitureProduct, FurnitureVariant } from '../src/lib/products';
import { placeholderProduct } from '../src/lib/workspace';

const family = new Map([
  ['B0F2ML48Y6', 'Oak'], ['B0D8P23H61', 'Black'], ['B0D8P1SVLG', 'Grey'],
  ['B0D8NSXYQ6', 'Light Brown'], ['B0F2MJHXBC', 'Rustic Brown'],
  ['B0DSZGP1HK', 'White'], ['B0D8NQHBBH', 'Brown'],
]);
const requestLimit = 4 * 1024;
const responseLimit = 5 * 1024 * 1024;
const missingModelMessage = 'A 3D model is not available for this product yet. This preview currently supports the LITTLE TREE round table.';

class ImportError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}
type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim();
}
function asinValue(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9]{10}$/i.test(value) ? value.toUpperCase() : undefined;
}
function amazonLink(value: unknown): { asin: string; url: string } {
  const message = 'Use an HTTPS amazon.com product link containing /dp/, /gp/product/, or /gp/aw/d/ and its ASIN. Short links are not supported.';
  if (typeof value !== 'string') throw new ImportError(message, 400);
  let url: URL;
  try { url = new URL(value); } catch { throw new ImportError(message, 400); }
  const match = url.pathname.match(/^\/(?:(?:[^/]+\/)?dp|gp\/product|gp\/aw\/d)\/([a-z0-9]{10})(?:\/ref=[^/]*)?\/?$/i);
  if (url.protocol !== 'https:' || !['amazon.com', 'www.amazon.com', 'm.amazon.com'].includes(url.hostname)
      || url.username || url.password || url.port || !match) throw new ImportError(message, 400);
  const asin = match[1].toUpperCase();
  return { asin, url: `https://www.amazon.com/dp/${asin}` };
}
function productLink(value: unknown, asin: string): string {
  if (value === undefined || value === null) return `https://www.amazon.com/dp/${asin}`;
  try {
    const link = amazonLink(value);
    if (link.asin === asin) return link.url;
  } catch { /* Backend metadata never becomes an arbitrary link. */ }
  throw new ImportError('Amazon returned inconsistent color links. Please try the product link again.');
}
interface Combination {
  asin: string;
  dimensions: Record<string, string>;
  unavailable: boolean;
  productUrl?: unknown;
}
function readCombinations(value: unknown): Combination[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ImportError('Amazon returned incomplete color information. Please try again.');
  return value.map(entry => {
    if (!record(entry) || !record(entry.dimensions) || !asinValue(entry.asin)
        || !Object.keys(entry.dimensions).length || !Object.values(entry.dimensions).every(nonempty)
        || !nonempty(entry.dimensions.color)
        || (entry.unavailable !== undefined && entry.unavailable !== null && typeof entry.unavailable !== 'boolean')) {
      throw new ImportError('Amazon returned incomplete color information. Please try again.');
    }
    return { asin: asinValue(entry.asin)!, dimensions: entry.dimensions as Record<string, string>,
      unavailable: entry.unavailable === true, productUrl: entry.productUrl };
  });
}
function sameOtherDimensions(a: Combination, b: Combination): boolean {
  const keys = Object.keys(a.dimensions).filter(key => key !== 'color');
  return keys.length === Object.keys(b.dimensions).filter(key => key !== 'color').length
    && keys.every(key => a.dimensions[key] === b.dimensions[key]);
}

/** Adapt the normalized backend response without inferring inventory, RGB values, or geometry. */
export function adaptAmazonProduct(raw: unknown, requestedAsin: string): FurnitureProduct {
  const asin = asinValue(requestedAsin);
  if (!record(raw) || raw.source !== 'serpapi' || !record(raw.product)) {
    throw new ImportError('The product service returned an unreadable product. Please try again.', 502);
  }
  const product = raw.product;
  if (!asin || asinValue(product.asin) !== asin) {
    throw new ImportError('Amazon returned a different product. Please check the product link and try again.');
  }
  if (!family.has(asin)) {
    throw new ImportError(missingModelMessage);
  }
  if (!nonempty(product.title)) throw new ImportError('Amazon did not return a product title. Please try again.');
  const measurements = record(product.dimensions) ? product.dimensions : undefined;
  const meters = measurements && record(measurements.meters) ? measurements.meters : undefined;
  if (measurements?.complete !== true || !meters || !['width', 'height', 'length'].every(key =>
    typeof meters[key] === 'number' && Number.isFinite(meters[key]) && meters[key] > 0 && meters[key] <= 20)) {
    throw new ImportError('This listing is missing complete width, height, and length measurements in meters. A measured product is required for the 3D preview.');
  }
  if (!Array.isArray(product.variantGroups)) throw new ImportError('Amazon did not return usable color options for this table.');
  const groups = product.variantGroups.filter(group => record(group) && group.kind === 'color');
  if (groups.length !== 1 || !record(groups[0]) || !Array.isArray(groups[0].options) || !groups[0].options.length) {
    throw new ImportError('Amazon did not return an unambiguous set of color options for this table.');
  }
  const combinations = readCombinations(product.variantCombinations);
  const currentMatches = combinations.filter(combination => combination.asin === asin);
  if (combinations.length && (currentMatches.length !== 1 || currentMatches[0].unavailable)) {
    throw new ImportError('Amazon did not identify an available color and size for this product. Please try another product link.');
  }
  const current = currentMatches[0];
  const labels = new Set<string>(), optionAsins = new Set<string>(), resolvedAsins = new Set<string>();
  const variants: FurnitureVariant[] = [];
  let selectedCount = 0;
  for (const option of groups[0].options) {
    if (!record(option) || !nonempty(option.label)) throw new ImportError('Amazon returned an unnamed color option. Please try again.');
    const label = option.label.trim(), directAsin = asinValue(option.asin);
    if (labels.has(label.toLocaleLowerCase()) || (directAsin && optionAsins.has(directAsin))) {
      throw new ImportError('Amazon returned duplicate or ambiguous color options. Please try again.');
    }
    labels.add(label.toLocaleLowerCase());
    if (directAsin) optionAsins.add(directAsin);
    let optionAsin = directAsin, link = option.productUrl;
    if (current) {
      const matches = combinations.filter(combination => combination.dimensions.color === label && sameOtherDimensions(current, combination));
      if (matches.length > 1) throw new ImportError('Amazon returned ambiguous color and size combinations. Please try again.');
      if (!matches.length || matches[0].unavailable) continue;
      optionAsin = matches[0].asin;
      link = matches[0].productUrl ?? (optionAsin === directAsin ? option.productUrl : undefined);
    } else if (!optionAsin) {
      throw new ImportError('Amazon did not provide a product identifier for each color. Please try again.');
    }
    if (!optionAsin || !family.has(optionAsin)) continue;
    if (family.get(optionAsin) !== label || resolvedAsins.has(optionAsin)) {
      throw new ImportError('Amazon returned inconsistent color identifiers. Please try again.');
    }
    resolvedAsins.add(optionAsin);
    if (option.selected === true) {
      selectedCount++;
      if (optionAsin !== asin || selectedCount > 1) throw new ImportError('Amazon returned an ambiguous selected color. Please try again.');
    }
    const palette = placeholderProduct.variants.find(variant => variant.name === label);
    if (!palette) continue;
    variants.push({ ...palette, id: optionAsin, asin: optionAsin, productUrl: productLink(link, optionAsin),
      ...(palette.materialOverrides ? { materialOverrides: palette.materialOverrides.map(override => ({ ...override })) } : {}) });
  }
  const selected = variants.find(variant => variant.asin === asin);
  if (!selected || (nonempty(product.selectedColor) && product.selectedColor.trim() !== selected.name)
      || (current && current.dimensions.color !== selected.name)) {
    throw new ImportError('Amazon did not return a matching color option for the selected table. Please try another product link.');
  }
  return parseProduct({
    id: asin, name: product.title.trim(), category: 'Tables',
    tagline: 'A round table. Room to gather.',
    description: 'Color previews are approximate. This preview uses the existing oak wood table model, with its original Oak texture and solid-color previews for other finishes.',
    dimensions: { width: meters.width, height: meters.height, depth: meters.length },
    material: selected.name, background: placeholderProduct.background, footprint: 'ellipse',
    variants: [selected, ...variants.filter(variant => variant !== selected)],
  });
}

function readRequest(request: IncomingMessage): Promise<unknown> {
  if (Number(request.headers['content-length']) > requestLimit) {
    request.resume();
    return Promise.reject(new ImportError('The import request is too large.', 413));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0, settled = false;
    const fail = (error: ImportError) => { if (!settled) { settled = true; reject(error); } };
    request.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > requestLimit) { chunks.length = 0; fail(new ImportError('The import request is too large.', 413)); return; }
      chunks.push(bytes);
    });
    request.on('end', () => {
      if (settled) return;
      try { const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); settled = true; resolve(body); }
      catch { fail(new ImportError('Send a valid JSON object containing the product URL.', 400)); }
    });
    request.on('error', () => fail(new ImportError('The import request was interrupted. Please try again.', 400)));
    request.on('aborted', () => fail(new ImportError('The import request was interrupted. Please try again.', 400)));
  });
}
async function readBackendResponse(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > responseLimit) {
    await response.body?.cancel();
    throw new ImportError('The product service returned too much data. Please try again.', 502);
  }
  if (!response.body) throw new ImportError('The product service returned an empty response. Please try again.', 502);
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > responseLimit) {
        await reader.cancel();
        throw new ImportError('The product service returned too much data. Please try again.', 502);
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ImportError('The product service returned an unreadable response. Please try again.', 502); }
}
function send(response: ServerResponse, status: number, body: unknown) {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(body));
}
export function createAmazonImportMiddleware(options: {
  backendBaseUrl: string; fetchImpl?: typeof fetch; authToken?: string;
}) {
  let backend: URL | undefined;
  try {
    const parsed = new URL(options.backendBaseUrl);
    if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash) backend = parsed;
  } catch { /* Configuration errors are reported without disclosing the configured value. */ }
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void): Promise<void> => {
    if (request.url?.split('?')[0] !== '/api/products/import') { next(); return; }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      send(response, 405, { error: 'Use POST to import a product.' });
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const body = await readRequest(request);
      if (!record(body)) throw new ImportError('Send a valid JSON object containing the product URL.', 400);
      const { asin } = amazonLink(body.url);
      if (!family.has(asin)) throw new ImportError(missingModelMessage);
      if (!backend) throw new ImportError('The product importer is not configured. Please contact the app owner.', 503);
      const target = new URL(`${backend.pathname.replace(/\/$/, '')}/v1/products/${asin}`, backend);
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 70_000);
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (options.authToken) headers.Authorization = `Bearer ${options.authToken}`;
      const result = await fetchImpl(target.href, { method: 'GET', headers, redirect: 'error', signal: controller.signal });
      if (!result.ok) {
        await result.body?.cancel();
        if (result.status === 404) throw new ImportError('Amazon could not find that product. Please check the link.', 404);
        if (result.status === 401 || result.status === 403) throw new ImportError('The product importer needs its service credentials checked by the app owner.', 503);
        if (result.status === 429) throw new ImportError('The product service is busy. Please try again in a moment.', 503);
        throw new ImportError('The product service could not load this listing. Please try again in a moment.', 502);
      }
      const product = adaptAmazonProduct(await readBackendResponse(result), asin);
      send(response, 200, { product });
    } catch (error) {
      if (error instanceof ImportError) send(response, error.status, { error: error.message });
      else if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        send(response, 504, { error: 'The product lookup timed out. Please try again.' });
      } else send(response, 502, { error: 'The product service is unavailable. Please try again in a moment.' });
    } finally { if (timer) clearTimeout(timer); }
  };
}
