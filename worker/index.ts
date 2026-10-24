// @ts-expect-error Partner transport and adapter are JavaScript and tested separately.
import { createImportHandler } from '../server/import-handler.js';
// @ts-expect-error Partner transport and adapter are JavaScript and tested separately.
import { createSearchHandler } from '../server/search-handler.js';
const importProduct = createImportHandler();
const searchProducts = createSearchHandler();
interface Env { ASSETS: { fetch(request: Request): Promise<Response> }; SERPAPI_API_KEY?: string }
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/products/import') return importProduct(request, env);
    if (url.pathname === '/api/products/search') return searchProducts(request, env);
    if (url.pathname.startsWith('/api/')) return Response.json({ error: { message: 'Not found.' } }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
