import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { sites } from './scripts/vite/sites-vite-plugin';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // Patch only model-viewer's exporter entry; the wrapper imports the upstream
    // addons entry without recursively resolving itself.
    alias: [{ find: /^three\/examples\/jsm\/exporters\/USDZExporter\.js$/, replacement: fileURLToPath(new URL('./src/lib/quick-look-model.ts', import.meta.url)) }],
  },
  plugins: [react(), sites(), cloudflare({
    viteEnvironment: { name: 'server' }, inspectorPort: false,
    config: {
      name: 'furniture-ar', main: './worker/index.ts', compatibility_date: '2026-05-15',
      compatibility_flags: ['nodejs_compat'],
      r2_buckets: [{ binding: 'MODEL_BUCKET', bucket_name: 'furniture-ar-models' }],
      assets: { binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*'] },
    },
  })],
  server: { host: '127.0.0.1', watch: { usePolling: true } },
  build: { chunkSizeWarningLimit: 1100 },
});
