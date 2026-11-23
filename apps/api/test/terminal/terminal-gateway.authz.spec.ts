// =============================================================================
// Terminal WebSocket authorization (issue #47)
// =============================================================================
//
// The gateway used to verify the JWT and `isActive` and check NO permission, so a
// Viewer (who holds only `sessions:read`) could open a terminal on a session they
// own, and the socket stayed authenticated after the 15-minute token expired.
//
// This drives the REAL `TerminalGateway` and the REAL identity slice (guards'
// principal resolution, the seeded role catalog) over a mocked database: only
// the SSH/tmux layer (`SessionManagerService`) is faked, so no remote host is
// needed. Users are shaped as production stores them (system `admin`, org roles
// on the membership) with permissions from `prisma/catalog/permissions.json`.
// =============================================================================

import { EventEmitter } from 'events';
import { JwtService } from '@nestjs/jwt';
import {
  TestContext,
  createTestApp,
  closeTestApp,
} from '../helpers/test-app.helper';
import { prismaMock, resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import {
  createMockAdminUser,
  createMockContributorUser,
  createMockViewerUser,
  TestUser,
} from '../helpers/auth-mock.helper';
import { TerminalGateway } from '../../src/terminal/terminal.gateway';
import { SessionManagerService } from '../../src/terminal/session-manager.service';
import { MOCK_DEFAULT_ORG_ID } from '../fixtures/test-data.factory';

const SESSION_ID = '5e55a0b1-7c1d-4f3e-9a2b-0c4d5e6f7a8b';
const OTHER_ORG_SESSION_ID = '6f66b1c2-8d2e-4a4f-8b3c-1d5e6f7a8b9c';

const sessionManager = {
  isSessionRunning: jest.fn().mockReturnValue(true),
  startSession: jest.fn().mockResolvedValue(undefined),
  attachWebSocket: jest.fn().mockReturnValue(true),
  sendInput: jest.fn(),
  resizeSession: jest.fn(),
  updateActivity: jest.fn(),
};

/** A WebSocket stand-in that records every control message the gateway sends. */
function createSocket() {
  const ws: any = Object.assign(new EventEmitter(), {
    readyState: 1,
    sent: [] as any[],
    closed: false,
    send(data: string) {
      this.sent.push(JSON.parse(data));
    },
    close() {
      this.closed = true;
      this.readyState = 3;
    },
    ping: jest.fn(),
  });
  return ws;
}

const send = (ws: any, payload: object) => ws.emit('message', Buffer.from(JSON.stringify(payload)), false);

/** Waits (real time) until `predicate` holds, or fails the test. */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the gateway');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const types = (ws: any): string[] => ws.sent.map((m: any) => m.type);

describe('TerminalGateway authorization (Integration)', () => {
  let context: TestContext;
  let gateway: TerminalGateway;
  const sockets: any[] = [];

  const open = () => {
    const ws = createSocket();
    sockets.push(ws);
    gateway.handleConnection(ws);
    return ws;
  };

  /** A short-lived access token for `user`, with the same claims the slice signs. */
  const shortLivedToken = (user: TestUser, expiresInSeconds: number): string =>
    context.module.get(JwtService).sign(
      { sub: user.id, email: user.email, roles: user.roles },
      { expiresIn: expiresInSeconds },
    );

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [{ provide: SessionManagerService, useValue: sessionManager }],
    });
    gateway = context.module.get(TerminalGateway);
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    jest.clearAllMocks();
    sessionManager.isSessionRunning.mockReturnValue(true);
    sessionManager.attachWebSocket.mockReturnValue(true);
  });

  afterEach(() => {
    for (const ws of sockets.splice(0)) gateway.handleDisconnect(ws);
  });

  /** The one session of `owner`, in the default organization, plus one in another organization. */
  function seedSessions(owner: TestUser) {
    const rows = [
      {
        id: SESSION_ID,
        userId: owner.id,
        orgId: MOCK_DEFAULT_ORG_ID,
        serverProfileId: 'profile-1',
        name: 'session-a',
        tmuxSessionId: 'sk-aaaa1111',
        status: 'active',
        cols: 80,
        rows: 24,
      },
      {
        id: OTHER_ORG_SESSION_ID,
        userId: owner.id,
        orgId: 'org-other',
        serverProfileId: 'profile-2',
        name: 'session-b',
        tmuxSessionId: 'sk-bbbb2222',
        status: 'active',
        cols: 80,
        rows: 24,
      },
    ];
    // Answers exactly what the where clause names: id AND owner AND organization.
    (prismaMock.terminalSession.findFirst as jest.Mock).mockImplementation(async ({ where }: any) => {
      const row = rows.find(
        (r) => r.id === where.id && r.userId === where.userId && r.orgId === where.orgId,
      );
      return row ? { ...row, serverProfile: null } : null;
    });
  }

  describe('auth', () => {
    it('refuses a Viewer with auth_fail forbidden and closes the socket', async () => {
      const viewer = await createMockViewerUser(context);
      const ws = open();

      send(ws, { type: 'auth', token: viewer.accessToken });
      await waitFor(() => ws.closed);

      expect(ws.sent).toEqual([{ type: 'auth_fail', reason: 'forbidden' }]);
    });

    it('lets a Viewer keep what they have over HTTP: sessions:read only, no sessions:write', async () => {
      // The reason the Viewer above is forbidden: the real seeded grants.
      const { catalogPermissionsOf } = await import('../fixtures/test-data.factory');
      expect(catalogPermissionsOf('viewer')).toEqual(expect.arrayContaining(['sessions:read', 'servers:read']));
      expect(catalogPermissionsOf('viewer')).not.toContain('sessions:write');
    });

    it('accepts a Contributor', async () => {
      const contributor = await createMockContributorUser(context);
      const ws = open();

      send(ws, { type: 'auth', token: contributor.accessToken });
      await waitFor(() => types(ws).includes('auth_ok'));

      expect(ws.closed).toBe(false);
    });

    it('accepts an Admin (the org_admin membership holds sessions:write)', async () => {
      const admin = await createMockAdminUser(context);
      const ws = open();

      send(ws, { type: 'auth', token: admin.accessToken });
      await waitFor(() => types(ws).includes('auth_ok'));
    });

    it('refuses a garbage token', async () => {
      const ws = open();

      send(ws, { type: 'auth', token: 'not.a.jwt' });
      await waitFor(() => ws.closed);

      expect(ws.sent).toEqual([{ type: 'auth_fail', reason: 'Invalid token' }]);
    });

    it('refuses a token signed with another secret', async () => {
      const contributor = await createMockContributorUser(context);
      const forged = new JwtService({ secret: 'another-secret-that-is-at-least-32-chars' }).sign({
        sub: contributor.id,
        email: contributor.email,
        roles: contributor.roles,
      });
      const ws = open();

      send(ws, { type: 'auth', token: forged });
      await waitFor(() => ws.closed);

      expect(ws.sent).toEqual([{ type: 'auth_fail', reason: 'Invalid token' }]);
    });

    it('refuses a deactivated user', async () => {
      const { createMockInactiveUser } = await import('../helpers/auth-mock.helper');
      const inactive = await createMockInactiveUser(context);
      const ws = open();

      send(ws, { type: 'auth', token: inactive.accessToken });
      await waitFor(() => ws.closed);

      expect(types(ws)).toEqual(['auth_fail']);
    });

    it('does not accept a token from anywhere but the first auth message', async () => {
      const contributor = await createMockContributorUser(context);
      const ws = open();

      // A connect before auth is refused; nothing in the URL can authenticate.
      send(ws, { type: 'connect', sessionId: SESSION_ID });
      await waitFor(() => types(ws).length > 0);

      expect(ws.sent[0]).toEqual({ type: 'auth_fail', reason: 'Not authenticated' });
      expect(contributor.accessToken).toBeDefined();
    });
  });

  describe('connect', () => {
    it('attaches the owner to their own session', async () => {
      const contributor = await createMockContributorUser(context);
      seedSessions(contributor);
      const ws = open();

      send(ws, { type: 'auth', token: contributor.accessToken });
      await waitFor(() => types(ws).includes('auth_ok'));
      send(ws, { type: 'connect', sessionId: SESSION_ID });
      await waitFor(() => types(ws).includes('session_ready'));

      expect(sessionManager.attachWebSocket).toHaveBeenCalledWith(SESSION_ID, ws);
    });

    it("answers NOT_FOUND for another user's session, without attaching", async () => {
      const owner = await createMockContributorUser(context, 'owner@example.test');
      const intruder = await createMockContributorUser(context, 'intruder@example.test');
      seedSessions(owner);
      const ws = open();

      send(ws, { type: 'auth', token: intruder.accessToken });
      await waitFor(() => types(ws).includes('auth_ok'));
      send(ws, { type: 'connect', sessionId: SESSION_ID });
      await waitFor(() => types(ws).includes('session_error'));

      expect(ws.sent.at(-1)).toEqual({ type: 'session_error', error: 'Session not found', code: 'NOT_FOUND' });
      expect(sessionManager.attachWebSocket).not.toHaveBeenCalled();
    });

    it('answers NOT_FOUND for an administrator who is not the owner (no admin read-any)', async () => {
      const owner = await createMockContributorUser(context, 'owner@example.test');
      const admin = await createMockAdminUser(context);
      seedSessions(owner);
      const ws = open();

      send(ws, { type: 'auth', token: admin.accessToken });
      await waitFor(() => types(ws).includes('auth_ok'));
      send(ws, { type: 'connect', sessionId: SESSION_ID });
      await waitFor(() => types(ws).includes('session_error'));

      expect(ws.sent.at(-1).code).toBe('NOT_FOUND');
    });

    it("answers NOT_FOUND for the user's own session in another organization", async () => {
      const contributor = await createMockContributorUser(context);
      seedSessions(contributor);
      const ws = open();

      send(ws, { type: 'auth', token: contributor.accessToken });
      await waitFor(() => types(ws).includes('auth_ok'));
      send(ws, { type: 'connect', sessionId: OTHER_ORG_SESSION_ID });
      await waitFor(() => types(ws).includes('session_error'));

      expect(ws.sent.at(-1).code).toBe('NOT_FOUND');
    });

    it('answers NOT_FOUND for an id that is not a UUID, without touching the database', async () => {
      const contributor = await createMockContributorUser(context);
      seedSessions(contributor);
      const ws = open();

      send(ws, { type: 'auth', token: contributor.accessToken });
      await waitFor(() => types(ws).includes('auth_ok'));
      (prismaMock.terminalSession.findFirst as jest.Mock).mockClear();
      send(ws, { type: 'connect', sessionId: "'; DROP TABLE users; --" });
      await waitFor(() => types(ws).includes('session_error'));

      expect(ws.sent.at(-1).code).toBe('NOT_FOUND');
      expect(prismaMock.terminalSession.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('token expiry', () => {
    it('closes the socket with auth_expired when the access token expires', async () => {
      const contributor = await createMockContributorUser(context);
      const ws = open();

      send(ws, { type: 'auth', token: shortLivedToken(contributor, 2) });
      await waitFor(() => types(ws).includes('auth_ok'));
      await waitFor(() => ws.closed, 5000);

      expect(types(ws)).toEqual(['auth_ok', 'auth_expired']);
    });

    it('ignores terminal input once the token has expired', async () => {
      const contributor = await createMockContributorUser(context);
      seedSessions(contributor);
      const ws = open();

      send(ws, { type: 'auth', token: shortLivedToken(contributor, 2) });
      await waitFor(() => types(ws).includes('auth_ok'));
      send(ws, { type: 'connect', sessionId: SESSION_ID });
      await waitFor(() => types(ws).includes('session_ready'));
      await waitFor(() => ws.closed, 5000);

      ws.emit('message', Buffer.from('ls\n'), true);

      expect(sessionManager.sendInput).not.toHaveBeenCalled();
    });

    it('keeps the socket open when the client re-authenticates with a fresh token', async () => {
      const contributor = await createMockContributorUser(context);
      const ws = open();

      send(ws, { type: 'auth', token: shortLivedToken(contributor, 2) });
      await waitFor(() => types(ws).includes('auth_ok'));
      send(ws, { type: 'auth', token: shortLivedToken(contributor, 30) });
      await waitFor(() => types(ws).includes('auth_refreshed'));

      // Past the first token's expiry the socket is still open and was never told it expired.
      await new Promise((resolve) => setTimeout(resolve, 3200));
      expect(ws.closed).toBe(false);
      expect(types(ws)).toEqual(['auth_ok', 'auth_refreshed']);
    }, 15000);

    it('refuses a re-auth as another user and closes the socket', async () => {
      const first = await createMockContributorUser(context, 'first@example.test');
      const second = await createMockContributorUser(context, 'second@example.test');
      const ws = open();

      send(ws, { type: 'auth', token: first.accessToken });
      await waitFor(() => types(ws).includes('auth_ok'));
      send(ws, { type: 'auth', token: second.accessToken });
      await waitFor(() => ws.closed);

      expect(ws.sent.at(-1)).toEqual({ type: 'auth_fail', reason: 'forbidden' });
    });

    it('refuses a re-auth with an invalid token and closes the socket', async () => {
      const contributor = await createMockContributorUser(context);
      const ws = open();

      send(ws, { type: 'auth', token: contributor.accessToken });
      await waitFor(() => types(ws).includes('auth_ok'));
      send(ws, { type: 'auth', token: 'garbage' });
      await waitFor(() => ws.closed);

      expect(ws.sent.at(-1)).toEqual({ type: 'auth_fail', reason: 'Invalid token' });
    });
  });
});
