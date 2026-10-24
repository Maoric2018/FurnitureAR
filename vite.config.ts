import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createAmazonImportMiddleware } from './server/amazon-import';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const importer = () => createAmazonImportMiddleware({
    backendBaseUrl: env.FURNITURE_API_BASE_URL ?? '',
    authToken: env.FURNITURE_API_AUTH_TOKEN,
  });
  return {
    plugins: [react(), {
      name: 'amazon-product-import',
      configureServer(server) { server.middlewares.use(importer()); },
      configurePreviewServer(server) { server.middlewares.use(importer()); },
    }],
    build: { chunkSizeWarningLimit: 1100 },
  };
});
