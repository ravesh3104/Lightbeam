/**
 * vite.config.ts - builds the React PWA directly into apps/server/public.
 *
 * Emitting into ../server/public means the unified Node server serves the exact
 * same single-page application in production with zero intermediate copy step,
 * while `npm run dev` runs Vite with HMR and proxies /api, /s and /r to the
 * local Node backend.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@lightbeam/core': resolve(here, '../../packages/core/src/index.ts'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/s': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/r': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    outDir: resolve(here, '../server/public'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
});
