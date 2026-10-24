import { parseProduct } from './products';
import type { FurnitureProduct } from './products';
export interface AmazonColorOption {
  asin: string; name: string; url: string; imageUrl: string | null; selected: boolean;
}
export interface AmazonColors {
  status: 'observed' | 'unconfirmed'; options: AmazonColorOption[];
}
export interface AmazonListing {
  asin: string; title: string; brand: string | null; url: string; images: string[];
  price: { amount: number; currency: string; display: string | null } | null;
  availability: string | null; features: string[]; dimensionText: string | null;
  dimensions: { width: number | null; height: number | null; depth: number | null } | null;
  retrievedAt: string; modelNote: string | null;
  // Missing only on listings saved before live color metadata was supported.
  colors?: AmazonColors;
}
export class ImportError extends Error {
  constructor(message: string, public code: string) { super(message); }
}
const credentialName = /^(?:api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|auth|authorization|password|secret|client[_-]?secret|credential|signature|sig|x-amz-(?:credential|signature|security-token))$/i;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function safeColorImage(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
      && ![...url.searchParams.keys()].some(key => credentialName.test(key));
  } catch { return false; }
}
function parseColors(value: unknown, listingAsin: string): AmazonColors {
  const invalid = () => new Error('The importer returned incomplete product colors. Please try again.');
  if (!record(value) || !['observed', 'unconfirmed'].includes(value.status as string)
      || !Array.isArray(value.options) || value.options.length > 100
      || (value.status === 'unconfirmed' && value.options.length !== 0)) throw invalid();
  const seen = new Set<string>();
  const options = value.options.map((option: unknown): AmazonColorOption => {
    if (!record(option) || typeof option.asin !== 'string' || !/^[A-Z0-9]{10}$/.test(option.asin)
        || seen.has(option.asin) || typeof option.name !== 'string' || !option.name.trim()
        || option.name.length > 200 || option.name !== option.name.trim() || /[\u0000-\u001f\u007f]/.test(option.name)
        || option.url !== `https://www.amazon.com/dp/${option.asin}`
        || (option.imageUrl !== null && !safeColorImage(option.imageUrl))
        || typeof option.selected !== 'boolean' || option.selected !== (option.asin === listingAsin)) throw invalid();
    seen.add(option.asin);
    return { asin: option.asin, name: option.name, url: option.url, imageUrl: option.imageUrl, selected: option.selected };
  });
  return { status: value.status as AmazonColors['status'], options };
}
export function parseListing(value: unknown): AmazonListing {
  if (!value || typeof value !== 'object') throw new Error('The importer returned no product details.');
  const p = value as AmazonListing;
  const nullableText = (v: unknown) => v === null || typeof v === 'string';
  const safeImage = (v: unknown) => {
    if (typeof v !== 'string') return false;
    try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && ![...u.searchParams.keys()].some(k => /^(api[_-]?key|token|access[_-]?token)$/i.test(k)); } catch { return false; }
  };
  if (!/^[A-Z0-9]{10}$/.test(p.asin) || typeof p.title !== 'string' || !p.title.trim()
      || p.url !== `https://www.amazon.com/dp/${p.asin}` || !Array.isArray(p.images) || !p.images.every(safeImage)
      || !Array.isArray(p.features) || !p.features.every(v => typeof v === 'string')
      || ![p.brand, p.availability, p.dimensionText, p.modelNote].every(nullableText)
      || !Number.isFinite(Date.parse(p.retrievedAt))
      || (p.price !== null && (!p.price || typeof p.price.amount !== 'number' || !Number.isFinite(p.price.amount) || p.price.amount < 0 || !/^[A-Z]{3}$/.test(p.price.currency) || !nullableText(p.price.display)))
      || (p.dimensions !== null && (!p.dimensions || !['width', 'height', 'depth'].every(k => { const d = p.dimensions![k as keyof NonNullable<AmazonListing['dimensions']>]; return d === null || (typeof d === 'number' && Number.isFinite(d) && d > 0 && d <= 20); })))) {
    throw new Error('The importer returned incomplete product details. Please try again.');
  }
  return p.colors === undefined ? p : { ...p, colors: parseColors(p.colors, p.asin) };
}
export async function importAmazonProduct(url: string, signal?: AbortSignal): Promise<{ listing: AmazonListing; product: FurnitureProduct | null }> {
  const response = await fetch(import.meta.env?.VITE_PRODUCT_API_URL || '/api/products/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal,
  });
  let data;
  try { data = await response.json(); } catch { throw new Error('The product service is unavailable. Please try again shortly.'); }
  if (!response.ok) throw new ImportError(typeof data.error?.message === 'string' ? data.error.message : 'We couldn’t import this product.', data.error?.code || 'IMPORT_FAILED');
  return { listing: parseListing(data.listing), product: data.product === null ? null : parseProduct(data.product) };
}
