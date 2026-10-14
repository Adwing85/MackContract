import react from '@vitejs/plugin-react';
import path from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Im Server-Build das Browser-Backend (sql.js, PDF.js …) durch einen leeren Platzhalter ersetzen. */
function stubLocalBackend(): Plugin {
  const stub = path.resolve(__dirname, 'src/local/stub.ts');
  return {
    name: 'stub-local-backend',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!source.endsWith('local/backend')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved && resolved.id.replace(/\\/g, '/').endsWith('src/local/backend.ts') ? stub : null;
    },
  };
}

// „npm run build:html“ baut mit mode=standalone eine einzelne HTML-Datei,
// die ohne Server im Browser läuft (siehe scripts/inline-html.mjs).
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    base: standalone ? './' : '/',
    plugins: standalone ? [react()] : [react(), stubLocalBackend()],
    define: {
      __STANDALONE__: JSON.stringify(standalone),
    },
    server: {
      port: 5173,
      proxy: standalone ? undefined : { '/api': `http://localhost:${process.env.API_PORT ?? 3001}` },
    },
    build: standalone
      ? {
          outDir: 'dist-html',
          emptyOutDir: true,
          sourcemap: false,
          assetsInlineLimit: Number.MAX_SAFE_INTEGER,
          cssCodeSplit: false,
          modulePreload: false,
          chunkSizeWarningLimit: 10_000,
          rollupOptions: { output: { codeSplitting: false } },
        }
      : {
          outDir: 'dist',
          sourcemap: false,
        },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
