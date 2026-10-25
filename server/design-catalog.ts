import inventory from '../public/models/catalog/catalog.json';
import type { AmazonListing } from '../src/lib/amazon';
import type { FurnitureProduct } from '../src/lib/products';

const supported = inventory.models.filter(m => ['seating', 'tables', 'storage'].includes(m.category));
export const designInventory = supported.map(m => ({ asin: m.asin, name: m.name, dimensions: m.dimensionsMeters }));
const stop = new Set(['with', 'and', 'the', 'for', 'inch', 'inches', 'wood', 'brown', 'black', 'white', 'grey', 'gray', 'furniture']);
function tokens(s: string) { return new Set(s.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2 && !stop.has(w))); }

/** Supplied prototypes are offered only after the exact live listing matches their identity. */
export function suppliedDesignModel(listing: AmazonListing): FurnitureProduct | null {
  const model = supported.find(m => m.asin === listing.asin);
  if (!model) return null;
  const expected = tokens(model.name), actual = tokens(listing.title);
  if ([...expected].filter(t => actual.has(t)).length < Math.min(3, expected.size)) return null;
  const dimensions = model.dimensionsMeters;
  // Do not silently stretch a conflicting model to fit another size variant.
  if (listing.dimensions && (['width', 'height', 'depth'] as const).some(axis => {
    const observed = listing.dimensions![axis];
    return observed !== null && Math.abs(observed - dimensions[axis]) > Math.max(.05, dimensions[axis] * .12);
  })) return null;
  const category = ({ seating: 'Seating', tables: 'Tables', storage: 'Storage' } as const)[model.category as 'seating' | 'tables' | 'storage'];
  const name = listing.colors?.options.find(c => c.selected)?.name ?? 'Supplied finish';
  return { id: model.id, name: listing.title, category, tagline: listing.brand ?? 'Amazon furniture',
    description: 'Supplied photo-based prototype. Appearance and dimensions are approximate; confirm the exact finish and size on Amazon.',
    material: 'Approximate product appearance', dimensions, background: '#eee9df', footprint: 'rectangle',
    variants: [{ id: listing.asin, asin: listing.asin, productUrl: listing.url, name, color: '#b69a7d', modelSrc: model.modelSrc, approximate: true }] };
}
