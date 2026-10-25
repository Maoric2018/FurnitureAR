import catalogData from '../data/catalog.json';

export type Category = 'Seating' | 'Tables' | 'Lighting' | 'Storage';
export type Unit = 'cm' | 'in';
export interface MaterialColorOverride { materialName: string; color: string }
export interface FurnitureVariant {
  id: string; name: string; color: string; modelSrc: string; iosSrc?: string;
  materialOverrides?: MaterialColorOverride[];
  approximate?: boolean;
  asin?: string;
  productUrl?: string;
}
export interface FurnitureProduct {
  id: string; name: string; category: Category; tagline: string; description: string;
  dimensions: { width: number; height: number; depth: number };
  material: string; badge?: string; background: string;
  footprint?: 'rectangle' | 'ellipse';
  scaleReference?: 'height' | 'width' | 'depth' | 'preview';
  variants: FurnitureVariant[];
}
export const catalog = catalogData as FurnitureProduct[];
export const categories: Category[] = ['Seating', 'Tables', 'Lighting', 'Storage'];
export function getVariant(product: FurnitureProduct, variantId?: string): FurnitureVariant {
  const variant = product.variants.find(candidate => candidate.id === variantId) ?? product.variants[0];
  if (!variant) throw new Error('This product has no available finishes.');
  return variant;
}
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
function validVariant(value: unknown): value is FurnitureVariant {
  if (!value || typeof value !== 'object') return false;
  const variant = value as Record<string, unknown>;
  const validText = (text: unknown): text is string => typeof text === 'string' && text.trim().length > 0;
  if (!validText(variant.id) || !validText(variant.name)
      || typeof variant.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(variant.color)
      || !validAsset(variant.modelSrc) || (variant.iosSrc !== undefined && !validAsset(variant.iosSrc))
      || (variant.approximate !== undefined && typeof variant.approximate !== 'boolean')
      || (variant.asin !== undefined && (typeof variant.asin !== 'string' || !/^[a-z0-9]{10}$/i.test(variant.asin)))) return false;
  if (variant.productUrl !== undefined) {
    if (typeof variant.productUrl !== 'string') return false;
    try { validateAmazonUrl(variant.productUrl); } catch { return false; }
  }
  if (variant.materialOverrides !== undefined) {
    if (!Array.isArray(variant.materialOverrides)) return false;
    const names = new Set<string>();
    for (const override of variant.materialOverrides) {
      if (!override || typeof override !== 'object' || !validText(override.materialName)
          || names.has(override.materialName) || typeof override.color !== 'string'
          || !/^#[0-9a-f]{6}$/i.test(override.color)) return false;
      names.add(override.materialName);
    }
  }
  return true;
}
export function parseProduct(value: unknown): FurnitureProduct {
  if (!value || typeof value !== 'object') throw new Error('The importer returned no product.');
  const p = value as Record<string, unknown>;
  const dims = p.dimensions as Record<string, unknown> | undefined;
  const validText = (key: string) => typeof p[key] === 'string' && (p[key] as string).trim().length > 0;
  if (!['id','name','description','material','tagline'].every(validText) || !categories.includes(p.category as Category)
      || (p.scaleReference !== undefined && !['height','width','depth','preview'].includes(p.scaleReference as string))
      || (p.footprint !== undefined && !['rectangle','ellipse'].includes(p.footprint as string))
      || !dims || !['width','height','depth'].every(k => typeof dims[k] === 'number' && Number.isFinite(dims[k]) && Number(dims[k]) > 0 && Number(dims[k]) <= 20)
      || !Array.isArray(p.variants) || !p.variants.length
      || !p.variants.every(validVariant)) {
    throw new Error('This product needs a valid 3D model and width, depth, and height in meters.');
  }
  if (new Set(p.variants.map(v => v.id)).size !== p.variants.length) throw new Error('Product finish IDs must be unique.');
  return { ...p, background: typeof p.background === 'string' && /^#[0-9a-f]{6}$/i.test(p.background) ? p.background : '#e9ede5' } as unknown as FurnitureProduct;
}
function isLocalImportEndpoint(endpoint: string): boolean {
  if (endpoint === '/api/products/import') return true;
  if (typeof location === 'undefined') return false;
  try {
    const target = new URL(endpoint, location.href);
    return target.origin === location.origin && target.pathname === '/api/products/import'
      && !target.username && !target.password;
  } catch { return false; }
}
export async function importProduct(url: string, endpoint: string, signal?: AbortSignal): Promise<FurnitureProduct> {
  const failure = 'We couldn’t import that product. Please try again in a moment.';
  let response: Response;
  try {
    response = await fetch(endpoint, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url}),signal});
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error(failure);
  }
  if (!response.ok) {
    let message = failure;
    if (isLocalImportEndpoint(endpoint) && !response.redirected) {
      try {
        const body: unknown = await response.json();
        const detail = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).error : undefined;
        if (typeof detail === 'string' && detail.length <= 400 && detail.trim()
            && !/[\u0000-\u001f\u007f]/.test(detail)) message = detail.trim();
      } catch { /* A proxy or malformed response must not replace the safe fallback. */ }
    }
    throw new Error(message);
  }
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new Error('The product service returned an unreadable response. Please try again.'); }
  return parseProduct(data && typeof data === 'object' ? (data as Record<string, unknown>).product : undefined);
}
