import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Issue #51: the worker cannot run in jsdom, so its contract is pinned as
 * source: the build owns `src/sw.ts` (injectManifest), which keeps the
 * prompt update handshake and registers the notifications slice's handlers
 * from the React-free entry.
 */

const root = join(__dirname, '..', '..', '..');
const sw = readFileSync(join(root, 'src', 'sw.ts'), 'utf8');
const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8');

describe('service worker (#51)', () => {
  it('is built from src/sw.ts with injectManifest and the prompt update flow', () => {
    expect(viteConfig).toMatch(/strategies:\s*'injectManifest'/);
    expect(viteConfig).toMatch(/filename:\s*'sw\.ts'/);
    expect(viteConfig).toMatch(/registerType:\s*'prompt'/);
  });

  it('registers the packaged push and notification-click handlers from the React-free entry', () => {
    expect(sw).toContain(
      "from '@marinoscar/platform-web/notifications/service-worker'",
    );
    expect(sw).toMatch(/registerNotificationServiceWorkerHandlers\(self/);
    expect(sw).not.toContain('@marinoscar/platform-web/notifications/headless');
  });

  it('precaches the shell and keeps the SKIP_WAITING handshake, without a top-level skipWaiting', () => {
    expect(sw).toContain('precacheAndRoute(self.__WB_MANIFEST)');
    expect(sw).toContain("event.data.type === 'SKIP_WAITING'");
    expect(sw).not.toMatch(/^self\.skipWaiting\(\)/m);
  });

  it('never serves the SPA shell for /api or caches anything under it', () => {
    expect(sw).toContain('denylist: [/^\\/api\\//');
    // One route only, the navigation fallback: no runtime caching route.
    expect(sw.match(/registerRoute\(/g)).toHaveLength(1);
    expect(sw).toMatch(/registerRoute\(\s*new NavigationRoute/);
    expect(sw).not.toMatch(/fetch\(/);
  });
});
