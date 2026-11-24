import { expect, test } from '@playwright/test';
import { THEMES, VIEWPORTS, expectTheme, openHarness } from '../support/harness';

/**
 * Runbooks (issue #65): the list over a fixture of runbooks (a running, a
 * failed and a finished last run, and one never run) at desktop and phone
 * width, and the builder opened empty. The live run view streams from the run
 * engine and is covered by its component tests.
 */

for (const theme of THEMES) {
  test.describe(`runbooks, ${theme}`, () => {
    test('list at 1280', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop1280);
      await openHarness(page, { theme, route: '/runbooks' });
      await expectTheme(page, theme);
      await expect(page.getByText('Rotate logs').first()).toBeVisible();
      await expect(page).toHaveScreenshot(`list-1280-${theme}.png`);
    });

    test('list at 360', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.phone360);
      await openHarness(page, { theme, route: '/runbooks' });
      await expect(page.getByText('Rotate logs').first()).toBeVisible();
      await expect(page).toHaveScreenshot(`list-360-${theme}.png`, { fullPage: true });
    });

    test('builder, new runbook, at 1280', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop1280);
      await openHarness(page, { theme, route: '/runbooks/new' });
      await expectTheme(page, theme);
      await expect(page.getByRole('heading').first()).toBeVisible();
      await expect(page).toHaveScreenshot(`builder-new-1280-${theme}.png`);
    });
  });
}
