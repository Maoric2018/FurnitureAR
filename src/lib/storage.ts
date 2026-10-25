import type { FurnitureProduct } from './products';
import { parseProduct } from './products';
export interface SavedPiece { product: FurnitureProduct; variantId: string }
const KEY = 'furniture-ar:saved:v1';
export function readSaved(): SavedPiece[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(data)) return [];
    return data.slice(0,100).flatMap(item => {
      try { const product = parseProduct(item.product); return product.variants.some(v => v.id === item.variantId) ? [{product,variantId:item.variantId}] : []; } catch { return []; }
    });
  } catch { return []; }
}
export function writeSaved(items: SavedPiece[]) { try { localStorage.setItem(KEY, JSON.stringify(items)); return true; } catch { return false; } }
export function readUnit(): 'cm' | 'in' { try { return localStorage.getItem('furniture-ar:unit') === 'in' ? 'in' : 'cm'; } catch { return 'cm'; } }
export function writeUnit(unit: string) { try { localStorage.setItem('furniture-ar:unit',unit); } catch { /* still works for this visit */ } }
