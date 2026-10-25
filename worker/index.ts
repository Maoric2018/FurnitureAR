import { createReconstructionHandler } from '../server/reconstruction-handler';
// @ts-expect-error Partner transport and adapter are JavaScript and tested separately.
import { createImportHandler } from '../server/import-handler.js';
// @ts-expect-error Partner transport and adapter are JavaScript and tested separately.
import { createSearchHandler } from '../server/search-handler.js';
import { createDesignHandler } from '../server/design-handler';
import { handleDemoDesign } from '../server/demo-design-handler';
import { ROOM_DESIGN_DEMO_ENABLED } from '../server/design-mode';
const designRoom = ROOM_DESIGN_DEMO_ENABLED ? handleDemoDesign : createDesignHandler();
const reconstruct = createReconstructionHandler();
const importProduct = createImportHandler();
const searchProducts = createSearchHandler();
interface Env { ASSETS: { fetch(request: Request): Promise<Response> }; SERPAPI_API_KEY?: string; ANTHROPIC_API_KEY?: string; CLAUDE_MODEL?: string; MODEL_API_URL?: string; MODEL_API_KEY?: string; MODEL_BUCKET?: R2Bucket }
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/design/room') return designRoom(request, env);
    if (url.pathname.startsWith('/api/reconstruction/')) return reconstruct(request, env);
    if (url.pathname === '/api/products/import') return importProduct(request, env);
    if (url.pathname === '/api/products/search') return searchProducts(request, env);
    if (url.pathname.startsWith('/api/products/models/')) return importProduct.models(request, env);
    if (url.pathname.startsWith('/api/')) return Response.json({ error: { message: 'Not found.' } }, { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
