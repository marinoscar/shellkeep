import { expect, test } from '@playwright/test';
import { fixture } from '../support/api';
import { THEMES, VIEWPORTS, expectTheme, openHarness } from '../support/harness';

// The chrome is what these shots are about, so Home shows its short empty state
// (no servers yet); the populated dashboard is `home.spec.ts`.
const quietHome = fixture('dashboard-empty.json');

/**
 * The shell (issue #76): Home inside the chrome at the three widths that pick a
 * different chrome (bottom bar, collapsed rail, expanded rail), the phone More
 * sheet, and Console mode. Each runs in light and dark.
 */

for (const theme of THEMES) {
  test.describe(`shell, ${theme}`, () => {
    for (const [name, viewport] of [
      ['360', VIEWPORTS.phone360],
      ['768', VIEWPORTS.tablet768],
      ['1280', VIEWPORTS.desktop1280],
    ] as const) {
      test(`Home at ${name}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openHarness(page, { theme, dashboard: quietHome });
        await expectTheme(page, theme);
        await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
        await expect(page).toHaveScreenshot(`home-${name}-${theme}.png`);
      });
    }

    test('phone More sheet open', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.phone360);
      await openHarness(page, { theme, dashboard: quietHome });
      await page.getByRole('button', { name: 'More' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page).toHaveScreenshot(`more-sheet-360-${theme}.png`);
    });

    test('Console mode at 1280', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop1280);
      await openHarness(page, { theme, route: '/admin/settings' });
      await expectTheme(page, theme);
      await expect(page.getByRole('link', { name: /Back to ShellKeep/ })).toBeVisible();
      await expect(page).toHaveScreenshot(`console-1280-${theme}.png`);
    });
  });
}
