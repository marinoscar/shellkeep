import { expect, test } from '@playwright/test';
import { THEMES, VIEWPORTS, expectTheme, openHarness, waitForTerminalFont } from '../support/harness';

/**
 * The settings hubs (issues #46, #48) at the phone and desktop widths, and the
 * Terminal settings card with its live preview (#80). Every card shown comes
 * from the real registries (`config/adminSections.tsx`,
 * `config/userSettingsSections.tsx`), filtered by the viewer's permissions.
 */

for (const theme of THEMES) {
  test.describe(`settings, ${theme}`, () => {
    for (const [name, viewport] of [
      ['360', VIEWPORTS.phone360],
      ['1280', VIEWPORTS.desktop1280],
    ] as const) {
      test(`user hub at ${name}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openHarness(page, { theme, route: '/settings' });
        await expectTheme(page, theme);
        await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible();
        await expect(page).toHaveScreenshot(`user-hub-${name}-${theme}.png`, {
          fullPage: name === '360',
        });
      });

      test(`Console hub at ${name}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openHarness(page, { theme, route: '/admin/settings' });
        await expectTheme(page, theme);
        await expect(page.getByRole('heading', { name: 'Console' }).first()).toBeVisible();
        await expect(page).toHaveScreenshot(`console-hub-${name}-${theme}.png`, {
          fullPage: name === '360',
        });
      });
    }

    test('Terminal card with its preview at 1280', async ({ page }) => {
      // Tall enough for the preview and the Appearance card; a full-page shot
      // would stop the rail at the viewport's height, so this is a viewport shot.
      await page.setViewportSize({ width: 1280, height: 1100 });
      await openHarness(page, { theme, route: '/settings/terminal' });
      await expectTheme(page, theme);
      await expect(page.locator('.xterm').first()).toBeVisible();
      await waitForTerminalFont(page);
      await expect(page).toHaveScreenshot(`terminal-card-1280-${theme}.png`);
    });
  });
}
