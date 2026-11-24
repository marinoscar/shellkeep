import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { api, ApiError } from '../../services/api';
import {
  getServerProfiles,
  testServerProfile,
  getSessions,
  createSession,
  batchTerminateSessions,
  downloadSessionHistory,
  scanHostKey,
  trustHostKey,
  forgetHostKey,
  refreshServerFacts,
} from '../../services/terminal-api';

describe('terminal-api', () => {
  beforeEach(() => {
    api.setAccessToken('test-token');
  });

  afterEach(() => {
    api.setAccessToken(null);
  });

  it('lists server profiles with the query it is given', async () => {
    let url = '';
    server.use(
      http.get('*/api/server-profiles', ({ request }) => {
        url = request.url;
        return HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 4 } });
      }),
    );

    const result = await getServerProfiles({ pageSize: 4, search: 'web' });

    expect(new URL(url).search).toBe('?pageSize=4&search=web');
    expect(result.items).toEqual([]);
  });

  it('omits the query string when no parameter is set', async () => {
    let url = '';
    server.use(
      http.get('*/api/server-profiles', ({ request }) => {
        url = request.url;
        return HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 20 } });
      }),
    );

    await getServerProfiles();

    expect(new URL(url).search).toBe('');
  });

  it('tests a server profile connection', async () => {
    server.use(
      http.post('*/api/server-profiles/p1/test', () =>
        HttpResponse.json({ data: { success: true } }),
      ),
    );

    await expect(testServerProfile('p1')).resolves.toEqual({ success: true });
  });

  it('drops the status filter when it is "all"', async () => {
    let url = '';
    server.use(
      http.get('*/api/sessions', ({ request }) => {
        url = request.url;
        return HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 5 } });
      }),
    );

    await getSessions({ status: 'all', pageSize: 5 });

    expect(new URL(url).search).toBe('?pageSize=5');
  });

  it('creates a session with the bearer token', async () => {
    let auth: string | null = null;
    let body: unknown;
    server.use(
      http.post('*/api/sessions', async ({ request }) => {
        auth = request.headers.get('Authorization');
        body = await request.json();
        return HttpResponse.json({ data: { id: 's1' } });
      }),
    );

    const session = await createSession({ serverProfileId: 'p1' });

    expect(auth).toBe('Bearer test-token');
    expect(body).toEqual({ serverProfileId: 'p1' });
    expect(session.id).toBe('s1');
  });

  it('batch-terminates sessions', async () => {
    server.use(
      http.post('*/api/sessions/batch-terminate', () =>
        HttpResponse.json({ data: { terminated: 2 } }),
      ),
    );

    await expect(batchTerminateSessions(['a', 'b'])).resolves.toEqual({ terminated: 2 });
  });

  it('raises ApiError when the history download fails', async () => {
    server.use(
      http.get('*/api/sessions/s1/history', () =>
        HttpResponse.json({ message: 'Not found' }, { status: 404 }),
      ),
    );

    await expect(downloadSessionHistory('s1')).rejects.toBeInstanceOf(ApiError);
  });

  describe('host keys (#60)', () => {
    const ID = 'p1';
    const PROFILE = { id: ID, hostname: 'server-a.example.test', fingerprint: 'SHA256:abc' };

    it('sends the bodyless scan, forget and facts refresh without a JSON content type', async () => {
      const seen: Array<{ method: string; path: string; contentType: string | null; body: string }> = [];
      const record = async (request: Request) => {
        seen.push({
          method: request.method,
          path: new URL(request.url).pathname,
          contentType: request.headers.get('content-type'),
          body: await request.text(),
        });
      };
      server.use(
        http.post('*/api/server-profiles/:id/host-key/scan', async ({ request }) => {
          await record(request);
          return HttpResponse.json({
            data: { presented: { fingerprint: 'SHA256:abc', algorithm: 'ssh-ed25519' }, trusted: null, matches: false },
          });
        }),
        http.delete('*/api/server-profiles/:id/host-key', async ({ request }) => {
          await record(request);
          return HttpResponse.json({ data: { ...PROFILE, fingerprint: null } });
        }),
        http.post('*/api/server-profiles/:id/facts/refresh', async ({ request }) => {
          await record(request);
          return HttpResponse.json({ data: { facts: null, factsProbedAt: null } });
        }),
      );

      const scan = await scanHostKey(ID);
      await forgetHostKey(ID);
      await refreshServerFacts(ID);

      expect(scan.matches).toBe(false);
      expect(seen.map((r) => `${r.method} ${r.path}`)).toEqual([
        `POST /api/server-profiles/${ID}/host-key/scan`,
        `DELETE /api/server-profiles/${ID}/host-key`,
        `POST /api/server-profiles/${ID}/facts/refresh`,
      ]);
      for (const request of seen) {
        expect(request.contentType).toBeNull();
        expect(request.body).toBe('');
      }
    });

    it('trusts with a JSON body, adding confirmHostname only when given', async () => {
      const bodies: unknown[] = [];
      const types: Array<string | null> = [];
      server.use(
        http.post('*/api/server-profiles/:id/host-key/trust', async ({ request }) => {
          types.push(request.headers.get('content-type'));
          bodies.push(await request.json());
          return HttpResponse.json({ data: PROFILE });
        }),
      );

      await trustHostKey(ID, 'SHA256:abc');
      await trustHostKey(ID, 'SHA256:abc', 'server-a.example.test');

      expect(types).toEqual(['application/json', 'application/json']);
      expect(bodies).toEqual([
        { fingerprint: 'SHA256:abc' },
        { fingerprint: 'SHA256:abc', confirmHostname: 'server-a.example.test' },
      ]);
    });
  });
});
