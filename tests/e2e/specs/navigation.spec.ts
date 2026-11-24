import { test, expect, type Page } from '@playwright/test';
import { loginAsAdmin, loginAsViewer } from '../helpers/auth.helper';

/**
 * Navigation (issue #81): sign in through `/testing/login` (development and
 * test builds only; the page does not exist in a production build), visit every
 * destination of the shell and confirm each route answers, then confirm the
 * Console needs an administrator.
 *
 * The routes are the destinations of `apps/web/src/config/destinations.ts`
 * (`DESTINATION_ROUTES`) plus the Console hub and the per-user settings hub.
 * `apps/web/src/__tests__/config/e2eNavigation.test.ts` fails when a
 * destination's path is missing from this list, so a new destination cannot
 * ship without a route here.
 */

/** Each destination's landing route, then the hubs and pages the rail and the user menu reach. */
const DESTINATION_ROUTES = [
  '/',
  '/sessions',
  '/servers',
  '/runbooks',
  '/runs',
  '/runbooks/approvals',
  '/settings',
  '/settings/terminal',
  '/settings/shortcuts',
  '/admin/settings',
] as const;

/** The rail (at the default desktop viewport); the phone's bottom bar is its own landmark. */
const mainNavigation = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });

/** A route "answers" when the page loads, stays on the route, draws the shell and no error screen. */
async function expectRouteAnswers(page: Page, route: string): Promise<void> {
  const response = await page.goto(route);
  expect(response?.ok(), `GET ${route}`).toBe(true);
  await expect(page).toHaveURL(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

test.describe('navigation as an administrator', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page, 'e2e-navigation-admin@example.test');
  });

  for (const route of DESTINATION_ROUTES) {
    test(`${route} answers`, async ({ page }) => {
      await expectRouteAnswers(page, route);
    });
  }

  test('the Console is in the navigation', async ({ page }) => {
    await expect(mainNavigation(page).getByRole('link', { name: 'Console' })).toBeVisible();
  });
});

test.describe('the Console needs an administrator', () => {
  test('a viewer is sent Home and the navigation has no Console', async ({ page }) => {
    await loginAsViewer(page, 'e2e-navigation-viewer@example.test');

    await page.goto('/admin/settings');
    await expect(page).toHaveURL(/\/$/);
    await expect(mainNavigation(page).getByRole('link', { name: 'Console' })).toHaveCount(0);

    // The users page of the Console is guarded the same way.
    await page.goto('/admin/settings/users');
    await expect(page).toHaveURL(/\/$/);
  });
});
