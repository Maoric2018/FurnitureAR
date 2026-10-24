// @ts-expect-error Partner transport and adapter are JavaScript and tested separately.
import { createImportHandler } from '../server/import-handler.js';
const importProduct = createImportHandler();
interface Env { ASSETS: { fetch(request: Request): Promise<Response> }; SERPAPI_API_KEY?: string }
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/products/import') return importProduct(request, env);
    if (url.pathname.startsWith('/api/')) return Response.json({ error: { message: 'Not found.' } }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
