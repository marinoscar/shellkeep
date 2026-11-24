import { expect, test, type Page } from '@playwright/test';
import { THEMES, VIEWPORTS, expectTheme, openHarness, waitForTerminalFont } from '../support/harness';

/**
 * The terminal workspace (issues #76, #77, #80): the one full-bleed page, which
 * is exactly the kind of layout jsdom cannot see. Every pane is a real xterm
 * fed by the harness's fake WebSocket (`apps/web/visual/fakeTerminalWs.ts`),
 * which replays a fixed byte stream and never answers a heartbeat, so the
 * status bar's latency stays empty instead of varying between runs.
 *
 * What these shots pin: the toolbar and tabs, the split, the Sessions context
 * pane beside the expanded rail, the AI panel docked at `md` and up, the
 * bottom bar's clearance on a phone (gate 3) and the key bar sitting directly
 * on a simulated keyboard. Moving the bottom bar or the key bar by a few
 * pixels fails these specs.
 */

const SPLIT = '/sessions/session-alpha?tabs=session-alpha,session-beta&split=v:session-alpha|session-beta';
const SINGLE = '/sessions/session-alpha?tabs=session-alpha';

/** Both streams replayed, the font in, the terminals refitted: nothing moves after this. */
async function waitForPanes(page: Page, expected: string[]): Promise<void> {
  for (const text of expected) {
    await expect(page.locator('.xterm-rows').filter({ hasText: text }).first()).toBeVisible();
  }
  await waitForTerminalFont(page);
}

for (const theme of THEMES) {
  test.describe(`terminal workspace, ${theme}`, () => {
    test('split with the context pane at 1280', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop1280);
      await openHarness(page, { theme, route: SPLIT });
      await expectTheme(page, theme);
      await expect(page.getByTestId('session-switcher-pane')).toBeVisible();
      await waitForPanes(page, ['built in 4.2s', 'job 1042 failed']);
      await expect(page).toHaveScreenshot(`split-1280-${theme}.png`);
    });

    test('AI panel open at 1280', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop1280);
      await openHarness(page, { theme, route: SINGLE, ai: true });
      await waitForPanes(page, ['built in 4.2s']);
      await page.getByRole('button', { name: 'AI', exact: true }).click();
      await expect(page.getByRole('button', { name: 'AI', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await waitForPanes(page, ['built in 4.2s']);
      await expect(page).toHaveScreenshot(`ai-panel-1280-${theme}.png`);
    });

    test.describe('on a touch screen', () => {
      // `hasTouch` makes `(pointer: coarse)` true, so the key bar's `auto` mode shows it.
      test.use({ hasTouch: true });

      test('key bar on the keyboard at 390x844', async ({ page }) => {
        const keyboard = 300;
        await page.setViewportSize(VIEWPORTS.phone390);
        await openHarness(page, { theme, route: SINGLE, keyboardInset: keyboard });
        await waitForPanes(page, ['built in 4.2s']);
        const dock = page.getByTestId('terminal-key-dock');
        await expect(dock).toBeVisible();
        await expect(dock.getByRole('button').first()).toBeVisible();

        // Beyond the pixels: the key bar's bottom edge sits on the keyboard's top
        // edge, to the pixel. (`keyDockOffset` in `TerminalWorkspacePage`.)
        await expect
          .poll(async () => {
            const box = await dock.boundingBox();
            return box ? Math.round(box.y + box.height) : null;
          })
          .toBe(VIEWPORTS.phone390.height - keyboard);

        await expect(page).toHaveScreenshot(`keybar-keyboard-390-${theme}.png`);
      });
    });
  });
}
