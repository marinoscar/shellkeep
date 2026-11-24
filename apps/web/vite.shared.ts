/**
 * How Vite resolves the workspace package `@shellkeep/shared`, shared by the app's
 * config (`vite.config.ts`) and the visual harness's (`visual/vite.config.ts`) so the
 * two cannot drift (#74, #81).
 *
 * `packages/shared` is CommonJS and reaches us as an npm WORKSPACE SYMLINK. Vite treats
 * a linked package as source: the dev server would serve its `index.js` as raw ESM (no
 * named exports) and Rollup's commonjs plugin, which by default only transforms
 * `node_modules`, would skip it in the build. Pre-bundle it in dev and include it in the
 * commonjs transform (#74: the Android identity).
 */
export const sharedPackageResolution = {
  optimizeDeps: { include: ['@shellkeep/shared'] },
  build: { commonjsOptions: { include: [/node_modules/, /packages[\\/]shared[\\/]/] } },
};
