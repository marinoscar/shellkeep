// =============================================================================
// Maintenance mode and the terminal WebSocket (issue #46)
// =============================================================================
//
// The platform's `MaintenanceGuard` covers HTTP only, so the gateway applies the
// same window itself. This drives the REAL `TerminalGateway`, the REAL identity
// slice and the REAL `MaintenanceModeService` of the host core over a mocked
// database; only the SSH/tmux layer is faked. The window is opened through the
// service's in-memory override, exactly as the break-glass path would.
//
//   - a NEW `auth` is refused with `{ type: 'auth_fail', reason: 'maintenance' }`
//     and the socket is closed;
//   - an administrator is let in while the window allows admins;
//   - a socket authenticated BEFORE the window keeps streaming (input is still
//     forwarded) and may refresh its token; it is never closed;
//   - a NEW `connect` on such a socket is refused with the same message, and the
//     socket stays open;
//   - the window closing lets everyone in again.
// =============================================================================

import { EventEmitter } from 'events';
import { MaintenanceModeService } from '@marinoscar/platform-api/host';
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
  TestUser,
} from '../helpers/auth-mock.helper';
import { TerminalGateway } from '../../src/terminal/terminal.gateway';
import { SessionManagerService } from '../../src/terminal/session-manager.service';
import { MOCK_DEFAULT_ORG_ID } from '../fixtures/test-data.factory';

const SESSION_ID = '5e55a0b1-7c1d-4f3e-9a2b-0c4d5e6f7a8b';

const sessionManager = {
  isSessionRunning: jest.fn().mockReturnValue(true),
  startSession: jest.fn().mockResolvedValue(undefined),
  attachWebSocket: jest.fn().mockReturnValue(true),
  sendInput: jest.fn(),
  resizeSession: jest.fn(),
  updateActivity: jest.fn(),
};

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

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the gateway');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const types = (ws: any): string[] => ws.sent.map((m: any) => m.type);

describe('TerminalGateway under maintenance mode (Integration)', () => {
  let context: TestContext;
  let gateway: TerminalGateway;
  let maintenance: MaintenanceModeService;
  const sockets: any[] = [];

  const open = () => {
    const ws = createSocket();
    sockets.push(ws);
    gateway.handleConnection(ws);
    return ws;
  };

  const windowOpen = (allowAdmins = true) =>
    maintenance.setInMemoryOverride({ enabled: true, message: 'Upgrading', allowAdmins });

  /** The owner's session, found by id AND owner AND organization (what the gateway asks for). */
  function seedSession(owner: TestUser) {
    (prismaMock.terminalSession.findFirst as jest.Mock).mockImplementation(async ({ where }: any) =>
      where.id === SESSION_ID && where.userId === owner.id && where.orgId === MOCK_DEFAULT_ORG_ID
        ? {
            id: SESSION_ID,
            userId: owner.id,
            orgId: MOCK_DEFAULT_ORG_ID,
            serverProfileId: 'profile-1',
            name: 'session-a',
            tmuxSessionId: 'sk-aaaa1111',
            status: 'active',
            cols: 80,
            rows: 24,
            serverProfile: null,
          }
        : null,
    );
  }

  beforeAll(async () => {
    context = await createTestApp({
      useMockDatabase: true,
      overrideProviders: [{ provide: SessionManagerService, useValue: sessionManager }],
    });
    gateway = context.module.get(TerminalGateway);
    maintenance = context.module.get(MaintenanceModeService);
  });

  afterAll(async () => {
    maintenance.setInMemoryOverride(null);
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
    jest.clearAllMocks();
    sessionManager.isSessionRunning.mockReturnValue(true);
    sessionManager.attachWebSocket.mockReturnValue(true);
    maintenance.setInMemoryOverride(null);
  });

  afterEach(() => {
    maintenance.setInMemoryOverride(null);
    for (const ws of sockets.splice(0)) gateway.handleDisconnect(ws);
  });

  it('refuses a new auth with auth_fail maintenance and closes the socket', async () => {
    const contributor = await createMockContributorUser(context);
    windowOpen();
    const ws = open();

    send(ws, { type: 'auth', token: contributor.accessToken });
    await waitFor(() => ws.closed);

    expect(ws.sent).toEqual([{ type: 'auth_fail', reason: 'maintenance' }]);
  });

  it('lets an administrator authenticate while the window allows admins', async () => {
    const admin = await createMockAdminUser(context);
    windowOpen(true);
    const ws = open();

    send(ws, { type: 'auth', token: admin.accessToken });
    await waitFor(() => types(ws).includes('auth_ok'));

    expect(ws.closed).toBe(false);
  });

  it('refuses an administrator too when the window does not allow admins', async () => {
    const admin = await createMockAdminUser(context);
    windowOpen(false);
    const ws = open();

    send(ws, { type: 'auth', token: admin.accessToken });
    await waitFor(() => ws.closed);

    expect(ws.sent).toEqual([{ type: 'auth_fail', reason: 'maintenance' }]);
  });

  it('lets users in again once the window closes', async () => {
    const contributor = await createMockContributorUser(context);
    windowOpen();
    const refused = open();
    send(refused, { type: 'auth', token: contributor.accessToken });
    await waitFor(() => refused.closed);

    maintenance.setInMemoryOverride(null);
    const ws = open();
    send(ws, { type: 'auth', token: contributor.accessToken });
    await waitFor(() => types(ws).includes('auth_ok'));
  });

  describe('a socket that was authenticated before the window opened', () => {
    async function attached() {
      const contributor = await createMockContributorUser(context);
      seedSession(contributor);
      const ws = open();
      send(ws, { type: 'auth', token: contributor.accessToken });
      await waitFor(() => types(ws).includes('auth_ok'));
      send(ws, { type: 'connect', sessionId: SESSION_ID });
      await waitFor(() => types(ws).includes('session_ready'));
      return { contributor, ws };
    }

    it('keeps streaming: terminal input is still forwarded and the socket stays open', async () => {
      const { ws } = await attached();

      windowOpen();
      ws.emit('message', Buffer.from('ls -la\n'), true);

      expect(sessionManager.sendInput).toHaveBeenCalledWith(SESSION_ID, Buffer.from('ls -la\n'));
      expect(ws.closed).toBe(false);
    });

    it('may still refresh its token, so a window does not cut the terminal off at token expiry', async () => {
      const { contributor, ws } = await attached();

      windowOpen();
      send(ws, { type: 'auth', token: contributor.accessToken });
      await waitFor(() => types(ws).includes('auth_refreshed'));

      expect(ws.closed).toBe(false);
    });

    it('is refused a NEW connect with auth_fail maintenance, without being closed', async () => {
      const { ws } = await attached();
      sessionManager.attachWebSocket.mockClear();

      windowOpen();
      send(ws, { type: 'connect', sessionId: SESSION_ID });
      await waitFor(() => ws.sent.some((m: any) => m.type === 'auth_fail'));

      expect(ws.sent.at(-1)).toEqual({ type: 'auth_fail', reason: 'maintenance' });
      expect(ws.closed).toBe(false);
      expect(sessionManager.attachWebSocket).not.toHaveBeenCalled();
    });
  });
});
