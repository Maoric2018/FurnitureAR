import catalogData from '../data/catalog.json';

export type Category = 'Seating' | 'Tables' | 'Lighting' | 'Storage';
export type Unit = 'cm' | 'in';
export interface FurnitureVariant { id: string; name: string; color: string; modelSrc: string; iosSrc?: string }
export interface FurnitureProduct {
  id: string; name: string; category: Category; tagline: string; description: string;
  dimensions: { width: number; height: number; depth: number };
  material: string; badge?: string; background: string;
  variants: FurnitureVariant[];
}
export const catalog = catalogData as FurnitureProduct[];
export const categories: Category[] = ['Seating', 'Tables', 'Lighting', 'Storage'];
export function dimensionsMatch(actual: {x:number;y:number;z:number}, expected: FurnitureProduct['dimensions']) {
  return [[actual.x,expected.width],[actual.y,expected.height],[actual.z,expected.depth]]
    .every(([a,b]) => Number.isFinite(a) && Math.abs(a-b) <= Math.max(.005,b*.03));
}
export function dimension(meters: number, unit: Unit) {
  return unit === 'cm' ? `${Math.round(meters * 100)}` : `${(meters / .0254).toFixed(1)}`;
}
export function dimensionSummary(product: FurnitureProduct, unit: Unit) {
  const d = product.dimensions;
  return `${dimension(d.width, unit)} × ${dimension(d.depth, unit)} × ${dimension(d.height, unit)} ${unit}`;
}
const amazonHosts = /(^|\.)amazon\.(com|ca|com\.mx|com\.br|co\.uk|de|fr|it|es|nl|se|pl|com\.be|ie|in|co\.jp|com\.au|sg|ae|sa|com\.tr|eg|co\.za)$/i;
export function validateAmazonUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error('Paste an Amazon product link to get started.');
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); }
  catch { throw new Error('That link doesn’t look quite right. Try copying it again.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !(amazonHosts.test(url.hostname) || ['amzn.to', 'a.co'].includes(url.hostname.toLowerCase()))) {
    throw new Error('Use a secure Amazon product link, such as https://www.amazon.com/dp/…');
  }
  if (url.pathname === '/' || url.pathname === '') throw new Error('Paste a link to a specific product, rather than the Amazon homepage.');
  return url.href;
}
function validAsset(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
export function parseProduct(value: unknown): FurnitureProduct {
  if (!value || typeof value !== 'object') throw new Error('The importer returned no product.');
  const p = value as Record<string, unknown>;
  const dims = p.dimensions as Record<string, unknown> | undefined;
  const validText = (key: string) => typeof p[key] === 'string' && (p[key] as string).trim().length > 0;
  if (!['id','name','description','material','tagline'].every(validText) || !categories.includes(p.category as Category)
      || !dims || !['width','height','depth'].every(k => typeof dims[k] === 'number' && Number.isFinite(dims[k]) && Number(dims[k]) > 0 && Number(dims[k]) <= 20)
      || !Array.isArray(p.variants) || !p.variants.length
      || !p.variants.every(v => v && typeof v.id === 'string' && typeof v.name === 'string' && /^#[0-9a-f]{6}$/i.test(v.color) && validAsset(v.modelSrc) && (!v.iosSrc || validAsset(v.iosSrc)))) {
    throw new Error('This product needs a valid 3D model and width, depth, and height in meters.');
  }
  if (new Set(p.variants.map(v => v.id)).size !== p.variants.length) throw new Error('Product finish IDs must be unique.');
  return { ...p, background: typeof p.background === 'string' && /^#[0-9a-f]{6}$/i.test(p.background) ? p.background : '#e9ede5' } as unknown as FurnitureProduct;
}
export async function importProduct(url: string, endpoint: string, signal?: AbortSignal): Promise<FurnitureProduct> {
  const response = await fetch(endpoint, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url}),signal});
  if (!response.ok) throw new Error('We couldn’t import that product. Please try again in a moment.');
  const data = await response.json();
  return parseProduct(data.product);
}
