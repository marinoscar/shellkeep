import { expect, test } from '@playwright/test';
import { THEMES, VIEWPORTS, expectTheme, openHarness } from '../support/harness';

/**
 * Home (issue #78): the dashboard over a fixture with unhealthy servers,
 * active and detached sessions, and a running, a failed and a finished run.
 * Relative times ("5m ago") read the page's fixed clock.
 */

for (const theme of THEMES) {
  for (const [name, viewport] of [
    // Tall enough for all three rows of the dashboard.
    ['1280', { width: 1280, height: 1000 }],
    ['360', VIEWPORTS.phone360],
  ] as const) {
    test(`dashboard at ${name}, ${theme}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openHarness(page, { theme });
      await expectTheme(page, theme);
      await expect(page.getByRole('heading', { name: 'Active sessions' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Recent runs' })).toBeVisible();
      await expect(page).toHaveScreenshot(`dashboard-${name}-${theme}.png`, { fullPage: name === '360' });
    });
  }
}
