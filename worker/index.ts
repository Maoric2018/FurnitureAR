import { createReconstructionHandler } from '../server/reconstruction-handler';
// @ts-expect-error Partner transport and adapter are JavaScript and tested separately.
import { createImportHandler } from '../server/import-handler.js';
// @ts-expect-error Partner transport and adapter are JavaScript and tested separately.
import { createSearchHandler } from '../server/search-handler.js';
const reconstruct = createReconstructionHandler();
const importProduct = createImportHandler();
const searchProducts = createSearchHandler();
interface Env { ASSETS: { fetch(request: Request): Promise<Response> }; SERPAPI_API_KEY?: string; MODEL_API_URL?: string; MODEL_API_KEY?: string; MODEL_BUCKET?: R2Bucket }
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/reconstruction/')) return reconstruct(request, env);
    if (url.pathname === '/api/products/import') return importProduct(request, env);
    if (url.pathname === '/api/products/search') return searchProducts(request, env);
    if (url.pathname.startsWith('/api/products/models/')) return importProduct.models(request, env);
    if (url.pathname.startsWith('/api/')) return Response.json({ error: { message: 'Not found.' } }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
