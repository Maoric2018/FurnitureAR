import { parseProduct } from './products';
import type { FurnitureProduct } from './products';
export interface AmazonListing {
  asin: string; title: string; brand: string | null; url: string; images: string[];
  price: { amount: number; currency: string; display: string | null } | null;
  availability: string | null; features: string[]; dimensionText: string | null;
  dimensions: { width: number | null; height: number | null; depth: number | null } | null;
  retrievedAt: string; modelNote: string | null;
}
export class ImportError extends Error {
  constructor(message: string, public code: string) { super(message); }
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
  return p;
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
