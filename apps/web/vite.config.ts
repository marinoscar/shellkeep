import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { BACKGROUND_COLOR, THEME_COLOR } from '@shellkeep/shared';
import { sharedPackageResolution } from './vite.shared';

/**
 * #148: the browser bar colour follows `themeColor` of
 * packages/shared/identity.json, like the PWA manifest below and the Android
 * build. `index.html` carries the `%SHELLKEEP_THEME_COLOR%` placeholder.
 */
const brandThemeColorMeta: Plugin = {
  name: 'shellkeep-theme-color',
  transformIndexHtml: (html) => html.replaceAll('%SHELLKEEP_THEME_COLOR%', THEME_COLOR),
};

export default defineConfig({
  plugins: [
    react(),
    brandThemeColorMeta,
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
        // packages/shared/identity.json (#148): the status bar and the splash.
        theme_color: THEME_COLOR,
        background_color: BACKGROUND_COLOR,
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
  optimizeDeps: sharedPackageResolution.optimizeDeps,
  build: {
    outDir: 'dist',
    sourcemap: true,
    commonjsOptions: sharedPackageResolution.build.commonjsOptions,
  },
});
