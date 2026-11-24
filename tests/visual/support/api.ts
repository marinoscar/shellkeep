import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Route } from '@playwright/test';

/**
 * The fake API of the visual harness (issue #81).
 *
 * The harness serves no API, so every `/api` call a page makes is answered
 * here, through Playwright's `page.route()`, from the JSON files under
 * `./fixtures`. Responses use the platform's `{ data: ... }` envelope.
 *
 * Rules that keep a baseline honest:
 *
 *  - Fixtures hold placeholders only (`server-a.example.test`, `Person A`),
 *    never a real host or user, and their timestamps are written relative to
 *    the page's fixed clock (`FIXED_NOW` in `harness.ts`).
 *  - A request with no handler answers `404` and is logged to stderr
 *    (`visual: unhandled API ...`), never silently dropped: a screen that
 *    renders its error state because a fixture is missing is a bad baseline.
 *  - Writes are accepted and not applied; a page under test never changes
 *    what the next read returns.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** One fixture file, parsed. */
export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
}

export interface ApiOptions {
  /** Whether `GET /api/ai/config` says AI is on (the terminal AI panel needs it). Default off. */
  ai?: boolean;
  /** The Servers page's rows. Default: `servers.json`. */
  servers?: unknown[];
  /** The Home summary. Default: `dashboard-summary.json`. */
  dashboard?: unknown;
  /** Override or add answers: `'GET /path'` to its `data`. Wins over the defaults. */
  responses?: Record<string, unknown>;
}

const MAINTENANCE_OFF = {
  enabled: false,
  message: '',
  allowAdmins: true,
  startedAt: null,
  startedById: null,
  source: 'persisted',
  layers: {
    env: { present: false, enabled: null },
    memory: { present: false, override: null },
    persisted: {
      readable: true,
      value: { enabled: false, message: '', allowAdmins: true, startedAt: null, startedById: null },
    },
  },
};

type Answer = unknown | ((url: URL, route: Route) => unknown);

function json(route: Route, data: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(status === 204 ? undefined : { data }),
  });
}

/** Install the fake API on `page`. Call before `page.goto()`. */
export async function installApi(page: Page, options: ApiOptions & { theme?: 'light' | 'dark' } = {}): Promise<void> {
  const servers = options.servers ?? fixture<{ items: unknown[] }>('servers.json').items;
  const sessions = fixture<{ items: Array<{ id: string }> }>('sessions.json');
  const settings = { ...fixture<Record<string, unknown>>('user-settings.json'), theme: options.theme ?? 'dark' };

  const table: Record<string, Answer> = {
    'GET /user-settings': settings,
    'PATCH /user-settings': settings,
    'PUT /user-settings': settings,
    'GET /ai/config': { enabled: options.ai === true, keyPolicy: 'byok', providers: [] },
    'GET /ai/terminal/consent': { consentAcceptedAt: '2025-01-02T09:00:00.000Z' },
    'GET /dashboard/summary': options.dashboard ?? fixture('dashboard-summary.json'),
    'GET /server-profiles': { items: servers, total: servers.length, page: 1, pageSize: 20 },
    'GET /server-profiles/tags': fixture('server-tags.json'),
    // Honours `serverProfileId` the way the API does (the server drawer's recent sessions).
    'GET /sessions': (url: URL) => {
      const server = url.searchParams.get('serverProfileId');
      const items = server
        ? sessions.items.filter((item) => (item as { serverProfileId?: string }).serverProfileId === server)
        : sessions.items;
      return { ...sessions, items, total: items.length };
    },
    'GET /exports/sources': { items: [] },
    // The shell's own chrome: the bell, the maintenance banner and the Runbooks badge.
    'GET /notifications/config': { browserEnabled: false, pushEnabled: false, vapidPublicKey: null },
    'GET /notifications': { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0, unreadCount: 0 },
    'GET /notifications/unread-count': { unreadCount: 0 },
    'GET /admin/maintenance': MAINTENANCE_OFF,
    'GET /runbook-approvals': (url: URL) =>
      url.searchParams.get('count') === 'true'
        ? { count: 0 }
        : { items: [], total: 0, page: 1, pageSize: 20 },
    ...(options.responses ?? {}),
  };

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');

    // The notification stream is a long-lived SSE read. Answer it as an open
    // stream with no frames, so the client sits connected and quiet.
    if (path === '/notifications/stream') {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': connected\n\n' });
      return;
    }
    const key = `${request.method()} ${path}`;

    let answer: Answer | undefined = key in table ? table[key] : undefined;

    if (answer === undefined) {
      const profile = /^\/server-profiles\/([^/]+)$/.exec(path);
      if (request.method() === 'GET' && profile) {
        answer = (servers as Array<{ id: string }>).find((item) => item.id === profile[1]);
      }
      const session = /^\/sessions\/([^/]+)$/.exec(path);
      if (request.method() === 'GET' && session) {
        answer = sessions.items.find((item) => item.id === session[1]);
      }
    }

    if (answer === undefined) {
      process.stderr.write(`visual: unhandled API ${key}\n`);
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: `No visual fixture for ${key}` } }),
      });
      return;
    }

    const body = typeof answer === 'function' ? (answer as (u: URL, r: Route) => unknown)(url, route) : answer;
    await json(route, body);
  });
}
