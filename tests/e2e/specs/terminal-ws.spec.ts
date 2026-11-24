import { test, expect } from '@playwright/test';

/**
 * The terminal WebSocket through nginx (issue #73).
 *
 * It needs the full stack (any mode built on the generated compose files, for
 * example base + dev + devdb) reachable at `BASE_URL`, default
 * http://localhost:8323, with the test login enabled (NODE_ENV is not
 * production). It signs in, opens `/api/terminal/ws` from the page (so the
 * page's CSP `connect-src` applies to the socket, as it does for a user),
 * authenticates, stays idle for 90 s, which is past the 60 s read timeout of
 * the platform's generic `location /api`, and expects a `pong` for a `ping`
 * on the same socket, with no 1006 close in between.
 *
 * The expiry of the 15-minute access token is the gateway's (it closes with
 * `auth_expired`); this spec stays far inside it.
 */
const IDLE_MS = 90_000;

test.setTimeout(IDLE_MS + 60_000);

test('the root page carries the platform CSP and security headers', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  const headers = res.headers();
  expect(headers['content-security-policy']).toContain("connect-src 'self'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBeTruthy();
});

test('an idle terminal WebSocket survives 90 s through nginx', async ({ page, request }) => {
  const login = await request.post('/api/auth/test/login', {
    form: { email: 'e2e-terminal-ws@example.test', role: 'admin', displayName: 'Person A' },
    maxRedirects: 0,
  });
  expect(login.status()).toBeLessThan(400);
  const refresh = await request.post('/api/auth/refresh');
  expect(refresh.status()).toBe(200);
  const token = (await refresh.json()).data.accessToken as string;

  await page.goto('/testing/login');

  const outcome = await page.evaluate(
    async ({ accessToken, idleMs }) => {
      const url = `${location.origin.replace(/^http/, 'ws')}/api/terminal/ws`;
      const ws = new WebSocket(url);
      const messages: string[] = [];
      let closeCode: number | null = null;
      ws.addEventListener('message', (e) => messages.push(String(e.data)));
      ws.addEventListener('close', (e) => {
        closeCode = e.code;
      });

      const waitFor = (type: string, ms: number) =>
        new Promise<boolean>((resolve) => {
          const started = Date.now();
          const tick = () => {
            if (messages.some((m) => m.includes(`"type":"${type}"`))) return resolve(true);
            if (closeCode !== null || Date.now() - started > ms) return resolve(false);
            setTimeout(tick, 100);
          };
          tick();
        });

      await new Promise<void>((resolve, reject) => {
        ws.addEventListener('open', () => resolve());
        ws.addEventListener('error', () => reject(new Error('websocket error before open')));
      });
      ws.send(JSON.stringify({ type: 'auth', token: accessToken }));
      const authed = await waitFor('auth_ok', 10_000);

      await new Promise((r) => setTimeout(r, idleMs));
      const stillOpenAfterIdle = ws.readyState === WebSocket.OPEN;

      let ponged = false;
      if (stillOpenAfterIdle) {
        ws.send(JSON.stringify({ type: 'ping' }));
        ponged = await waitFor('pong', 10_000);
      }
      ws.close();
      return { authed, stillOpenAfterIdle, ponged, closeCode };
    },
    { accessToken: token, idleMs: IDLE_MS },
  );

  expect(outcome.authed).toBe(true);
  expect(outcome.stillOpenAfterIdle).toBe(true);
  expect(outcome.ponged).toBe(true);
  expect(outcome.closeCode === null || outcome.closeCode !== 1006).toBe(true);
});
