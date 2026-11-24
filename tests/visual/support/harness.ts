import { expect, type Page } from '@playwright/test';
import { installApi, type ApiOptions } from './api';

/**
 * Shared helpers for the visual specs (issue #81).
 *
 * Every spec goes through {@link openHarness}, so the query-param contract of
 * `apps/web/visual/main.tsx` and the determinism pins (clock, fixtures,
 * fonts) have one place to change.
 */

/**
 * The page's fixed `Date.now()`. Every relative time on a screen ("5 minutes
 * ago", the Home dashboard) is measured against it, and every fixture's
 * timestamps are written relative to it. `timezoneId` and `locale` are pinned
 * by `playwright.config.ts` (UTC, en-US).
 */
export const FIXED_NOW = '2025-01-15T12:00:00.000Z';

/** The viewports the specs use. */
export const VIEWPORTS = {
  phone360: { width: 360, height: 740 },
  phone390: { width: 390, height: 844 },
  tablet768: { width: 768, height: 900 },
  desktop1280: { width: 1280, height: 800 },
} as const;

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export interface HarnessOptions extends ApiOptions {
  /** Initial router entry, query string included. Default `/`. */
  route?: string;
  /** Becomes `user.permissions`. Default: every permission the API has. */
  perms?: string[];
  /** Written to `localStorage.theme_mode` before the first render. Default `dark`. */
  theme?: Theme;
  /** Becomes `user.roles`. Default `['admin']`. */
  roles?: string[];
  /** Recorded on `<html data-fixture>`, so a failing shot says which state it was. */
  fixture?: string;
  /**
   * Simulate an on-screen keyboard this many pixels tall: a fixed
   * `visualViewport` whose bottom edge sits that far above the layout
   * viewport's, which is what `useKeyboardInset` measures.
   */
  keyboardInset?: number;
}

/** The path and query to `page.goto()`. Relative, so it composes with `baseURL`. */
export function harnessUrl(options: HarnessOptions = {}): string {
  const params = new URLSearchParams();
  if (options.route) params.set('route', options.route);
  if (options.perms) params.set('perms', options.perms.join(','));
  if (options.theme) params.set('theme', options.theme);
  if (options.roles) params.set('roles', options.roles.join(','));
  if (options.fixture) params.set('fixture', options.fixture);
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

/** The visual viewport a keyboard of `inset` px leaves, before the app reads it. */
async function installVisualViewportMock(page: Page, inset: number): Promise<void> {
  await page.addInitScript((keyboard: number) => {
    const target = new EventTarget();
    const mock = {
      get height() {
        return window.innerHeight - keyboard;
      },
      width: window.innerWidth,
      offsetTop: 0,
      offsetLeft: 0,
      pageTop: 0,
      pageLeft: 0,
      scale: 1,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    };
    Object.defineProperty(window, 'visualViewport', { value: mock, configurable: true });
  }, inset);
}

/**
 * Open the harness in a pinned state and wait until it has settled: the clock
 * frozen, the API answered from fixtures, the fonts loaded.
 */
export async function openHarness(page: Page, options: HarnessOptions = {}): Promise<void> {
  await page.clock.setFixedTime(new Date(FIXED_NOW));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installApi(page, { ...options, theme: options.theme ?? 'dark' });
  if (options.keyboardInset) await installVisualViewportMock(page, options.keyboardInset);
  await page.goto(harnessUrl({ ...options, theme: options.theme ?? 'dark' }));
  await waitForSettled(page);
}

/**
 * Block until nothing is still loading: no progress indicator, every web font
 * (the bundled terminal font included) loaded. `toHaveScreenshot()` re-shoots
 * until two frames agree, but "usually" is not a property a baseline suite may
 * rely on.
 */
export async function waitForSettled(page: Page): Promise<void> {
  // Every fixture answered: a late response re-lays-out a toolbar by a sub-pixel.
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/** Assert the harness really applied the requested theme (a shot in the wrong one is a bad baseline). */
export async function expectTheme(page: Page, theme: Theme): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe(theme === 'dark' ? 'rgb(18, 18, 18)' : 'rgb(245, 245, 245)');
}

/**
 * Wait for the bundled terminal font (JetBrains Mono, `@fontsource`, loaded on
 * demand by `ensureTerminalFont`), then let xterm re-measure. A terminal
 * measured against the fallback face draws misaligned cells, so a shot taken
 * before this resolves would bake that in.
 */
export async function waitForTerminalFont(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.fonts.check('14px "JetBrains Mono"')), { timeout: 15_000 })
    .toBe(true);
  await page.evaluate(async () => {
    await document.fonts.load('14px "JetBrains Mono"');
    await document.fonts.ready;
  });
  // One frame for xterm's resize observer to refit after the font swap.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
