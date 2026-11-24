import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Pixel-based visual regression tests (issue #81).
 *
 * A SIBLING of `../e2e`, not an extension of it. `../e2e` drives the real
 * Docker Compose stack (`localhost:8323`) for behaviour; this project boots
 * nothing but the harness in `apps/web/visual` (see its `main.tsx`: the real
 * routes behind a fake auth context, a fake terminal WebSocket and JSON
 * fixtures from `page.route()`), and screenshots the real React pages.
 *
 * PINNED, ON PURPOSE. A pixel baseline depends on the exact browser BUILD, not
 * the Playwright API version, so `@playwright/test` is pinned with no caret in
 * `package.json` and the baselines under `__screenshots__/` are generated ONLY
 * inside `mcr.microsoft.com/playwright:v<that version>-noble`. The version
 * lives in three places that change together: `package.json`,
 * `.github/workflows/ci.yml` (the `visual` job) and
 * `.github/workflows/visual-baselines.yml`.
 *
 * DETERMINISM. The page runs with a fixed clock and reduced motion
 * (`support/harness.ts`), UTC, `en-US`, one device pixel per CSS pixel and the bundled
 * terminal font (JetBrains Mono, from `@fontsource`); the UI text uses the
 * fonts of the pinned image. Run it anywhere else and the pixels differ.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

// `apps/web`'s dependencies are hoisted into the root `node_modules` by the
// workspace install, which is where Vite lives.
const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const harnessConfig = path.join(repoRoot, 'apps', 'web', 'visual', 'vite.config.ts');

const PORT = 5183;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  // One flat directory for every baseline: `__screenshots__/<spec file>/<name>.png`.
  // No platform suffix: the baselines are Linux-only, from the pinned image.
  snapshotPathTemplate: '{snapshotDir}/{testFileName}/{arg}{ext}',
  // `VISUAL_SNAPSHOT_DIR` is for a throwaway smoke run only (it must never be
  // used to commit baselines): it keeps locally generated images out of the tree.
  snapshotDir: process.env.VISUAL_SNAPSHOT_DIR || './__screenshots__',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries, deliberately: a retry that "passes" a pixel diff is the flake
  // this suite exists to make impossible to hide.
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }]],
  expect: {
    toHaveScreenshot: {
      // Freeze CSS animations and transitions (the ripple, the rail's width
      // transition, the spinner) so a shot never lands mid-animation.
      animations: 'disabled',
      // An absolute count, not a ratio: a regression such as a bar moved by a
      // few pixels changes only the pixels along its edges, which a ratio of a
      // full-page screenshot would dilute away.
      maxDiffPixels: 4,
      // pixelmatch's per-pixel colour sensitivity (Playwright's default is 0.2).
      threshold: 0.05,
    },
  },
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    launchOptions: {
      // ONLY for a smoke run on a machine whose Chromium is not the pinned
      // image's (no baseline is ever generated this way): point at it.
      executablePath: process.env.VISUAL_CHROMIUM_PATH || undefined,
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } }],
  // Builds the harness and serves the BUILT bundle (see `apps/web/visual/vite.config.ts`
  // for why not a dev server). Never the app's own config, never the Compose
  // stack. A stale server is never reused in CI.
  webServer: {
    command: `node "${viteBin}" build --config "${harnessConfig}" && node "${viteBin}" preview --config "${harnessConfig}"`,
    cwd: repoRoot,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    // The build's warnings are noise; a build failure still shows on stderr.
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 240_000,
  },
});
