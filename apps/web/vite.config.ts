import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // #51: the app owns its worker (`src/sw.ts`) so the notifications
      // slice's push and notification-click handlers live in it; the plugin
      // injects the precache manifest. `registerType: 'prompt'` keeps the
      // update flow of #46 (`UpdatePrompt` with `useRegisterSW`, which
      // registers the worker, hence no injected registration script).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: null,
      devOptions: {
        enabled: false,
      },
      manifest: {
        name: 'ShellKeep',
        short_name: 'ShellKeep',
        description: 'Browser-based terminal workspace with persistent sessions',
        theme_color: '#121212',
        background_color: '#121212',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-maskable-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'apple-touch-icon-180x180.png',
            sizes: '180x180',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      // Built static assets only: nothing under `/api` is ever cached (see
      // the header of `src/sw.ts`).
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    allowedHosts: ['.dev.marin.cr'],
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  // `@shellkeep/shared` (packages/shared) is CommonJS and reaches us as an npm WORKSPACE
  // SYMLINK. Vite treats a linked package as source: the dev server would serve its
  // `index.js` as raw ESM (no named exports) and Rollup's commonjs plugin, which by
  // default only transforms `node_modules`, would skip it in the build. Pre-bundle it in
  // dev and include it in the commonjs transform (#74: the Android identity).
  optimizeDeps: { include: ['@shellkeep/shared'] },
  build: {
    outDir: 'dist',
    sourcemap: true,
    commonjsOptions: { include: [/node_modules/, /packages[\\/]shared[\\/]/] },
  },
});
