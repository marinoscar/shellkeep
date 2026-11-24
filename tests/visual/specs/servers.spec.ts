import { expect, test } from '@playwright/test';
import { THEMES, VIEWPORTS, expectTheme, openHarness } from '../support/harness';

/**
 * Servers (issue #79): the table at desktop width, the cards on a phone, and
 * the detail drawer. The rows are `support/fixtures/servers.json`: reachable,
 * unreachable and never-tested servers, an untrusted host key and a mismatch.
 */

for (const theme of THEMES) {
  test.describe(`servers, ${theme}`, () => {
    test('table at 1280', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop1280);
      await openHarness(page, { theme, route: '/servers' });
      await expectTheme(page, theme);
      await expect(page.getByRole('heading', { name: 'Servers' })).toBeVisible();
      await expect(page.getByText('server-a.example.test').first()).toBeVisible();
      await expect(page).toHaveScreenshot(`table-1280-${theme}.png`);
    });

    test('cards at 360', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.phone360);
      await openHarness(page, { theme, route: '/servers' });
      await expect(page.getByText('server-a.example.test').first()).toBeVisible();
      await expect(page).toHaveScreenshot(`cards-360-${theme}.png`, { fullPage: true });
    });

    test('detail drawer at 1280', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop1280);
      await openHarness(page, { theme, route: '/servers' });
      await page.getByText('server-a', { exact: true }).first().click();
      const drawer = page.getByTestId('server-detail-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByText('Build')).toBeVisible(); // its recent session
      await expect(page).toHaveScreenshot(`drawer-1280-${theme}.png`);
    });
  });
}
