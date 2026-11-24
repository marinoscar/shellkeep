import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * The terminal workspace on a phone (issue #77): 390x844 with touch. It needs
 * the full stack AND an SSH server the API can reach, given as
 * E2E_SSH_HOST / E2E_SSH_PORT / E2E_SSH_USER / E2E_SSH_PASSWORD (a throwaway
 * test account); without them the spec is skipped. The server's host key is
 * trusted through the #60 dialog, as a user would.
 */
const SSH = {
  host: process.env.E2E_SSH_HOST,
  port: Number(process.env.E2E_SSH_PORT ?? 22),
  username: process.env.E2E_SSH_USER,
  password: process.env.E2E_SSH_PASSWORD,
};

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
test.skip(!SSH.host || !SSH.username || !SSH.password, 'E2E_SSH_HOST, E2E_SSH_USER and E2E_SSH_PASSWORD are not set');

async function signIn(request: APIRequestContext): Promise<Record<string, string>> {
  const login = await request.post('/api/auth/test/login', {
    form: { email: 'e2e-workspace@example.test', role: 'admin', displayName: 'Person A' },
    maxRedirects: 0,
  });
  expect(login.status()).toBeLessThan(400);
  const refresh = await request.post('/api/auth/refresh');
  const token = (await refresh.json()).data.accessToken as string;
  return { Authorization: `Bearer ${token}` };
}

async function createSession(request: APIRequestContext): Promise<string> {
  const headers = await signIn(request);
  const run = Date.now() % 100000;
  const profile = await request.post('/api/server-profiles', {
    headers,
    data: { name: `e2e-server-${run}`, hostname: SSH.host, port: SSH.port, username: SSH.username, authMethod: 'password', password: SSH.password },
  });
  expect(profile.status()).toBe(201);
  const session = await request.post('/api/sessions', {
    headers,
    data: { serverProfileId: (await profile.json()).data.id, name: `e2e-${run}` },
  });
  expect(session.status()).toBe(201);
  return (await session.json()).data.id as string;
}

const visiblePane = (page: Page) => page.locator('[data-pane-visible="true"]');
const screenText = (page: Page) => visiblePane(page).locator('.xterm-rows').innerText();

test.describe('terminal workspace on a phone', () => {
  test('opens a session, swipes the scrollback and sends Ctrl-C from the key bar', async ({ page }) => {
    const sessionId = await createSession(page.request);
    await page.goto(`/sessions/${sessionId}`);

    // A new server: trust its host key in the #60 dialog.
    const hostKey = page.getByTestId('host-key-dialog');
    await hostKey.waitFor();
    await hostKey.getByRole('button', { name: 'Trust and connect' }).click();
    await expect(visiblePane(page).locator('.xterm-rows')).toContainText('$', { timeout: 20000 });

    // Full-bleed, one pane, nothing off-screen, no page scroll.
    await expect(page.locator('main')).toHaveAttribute('data-main-variant', 'full-bleed');
    await expect(visiblePane(page)).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);

    // Scrollback to swipe through.
    await visiblePane(page).locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('seq 1 300\n');
    await expect(visiblePane(page).locator('.xterm-rows')).toContainText('300');
    const before = await screenText(page);

    // A finger moving down scrolls back (tmux copy mode shows its position).
    const box = (await visiblePane(page).locator('.xterm-screen').boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const x = box.x + box.width / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: box.y + 60 }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: box.y + 60 + i * 25 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => screenText(page)).not.toBe(before);
    await expect(visiblePane(page).locator('.xterm-rows')).toContainText(/\[\d+\/\d+\]/);
    await page.keyboard.press('q');

    // The key bar (open by default on a phone) interrupts a running command.
    await visiblePane(page).locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('clear; sleep 60\n');
    await page.getByRole('button', { name: 'Ctrl+C' }).tap();
    await expect(visiblePane(page).locator('.xterm-rows')).toContainText('^C');
  });
});
