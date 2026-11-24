import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sharedPackageResolution } from '../vite.shared';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vite config for the visual regression harness (issue #81) ONLY.
 *
 * Separate from `apps/web/vite.config.ts` on purpose: this entry exists so
 * `tests/visual`'s Playwright project has something to point a browser at, and
 * it must never be reachable from, or confused with, the real app's dev or
 * build config (`npm run build` in `apps/web` never imports anything under
 * `visual/`).
 *
 * It is BUILT and then served by `vite preview` (see `tests/visual/
 * playwright.config.ts`), not run as a dev server. A dev server pre-bundles
 * dependencies on first use and reloads the page when it finds a new one, which
 * lands in the middle of a screenshot; a built bundle has no such step.
 *
 * - `root: here` makes `apps/web/visual/` its own document root.
 * - `publicDir` serves the app's own `apps/web/public` (icons).
 * - NO `VitePWA`: see `pwaRegisterStub.ts`. `virtual:pwa-register/react` is
 *   aliased to the stub instead.
 * - NO `/api` proxy: nothing listens behind it. Every `/api` call the pages
 *   make is answered by Playwright's `page.route()` from
 *   `tests/visual/support/fixtures`.
 */
export default defineConfig({
  root: here,
  publicDir: path.resolve(here, '..', 'public'),
  plugins: [react()],
  resolve: {
    alias: {
      'virtual:pwa-register/react': path.resolve(here, 'pwaRegisterStub.ts'),
    },
  },
  // The app's own resolution of the CommonJS workspace package `@shellkeep/shared`.
  optimizeDeps: sharedPackageResolution.optimizeDeps,
  build: {
    commonjsOptions: sharedPackageResolution.build.commonjsOptions,
    outDir: path.resolve(here, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: { port: 5183, strictPort: true, host: true },
  preview: { port: 5183, strictPort: true, host: true },
});
