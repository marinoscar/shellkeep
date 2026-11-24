import { EventEmitter } from 'events';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TerminalGateway } from './terminal.gateway';

const ORG = 'org-alpha';
const PROFILE = 'profile-1';
const S1 = '5e55a0b1-7c1d-4f3e-9a2b-0c4d5e6f7a81';
const S2 = '5e55a0b1-7c1d-4f3e-9a2b-0c4d5e6f7a82';

function mockWs(): any {
  return Object.assign(new EventEmitter(), { readyState: 1, send: jest.fn(), close: jest.fn(), ping: jest.fn() });
}
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

describe('TerminalGateway share revocation (#145)', () => {
  let gateway: TerminalGateway;
  let serverProfiles: { assertCanConnect: jest.Mock; getDecryptedProfile: jest.Mock };
  let manager: { isSessionRunning: jest.Mock; attachWebSocket: jest.Mock; detachWebSocket: jest.Mock };
  let socks: any[];

  async function attach(userId: string, sessionId: string): Promise<any> {
    const principals = {
      resolve: jest.fn().mockResolvedValue({
        ok: true,
        principal: { userId, orgId: ORG, permissions: ['sessions:write'], roles: ['contributor'], expiresAtMs: Date.now() + 60_000 },
      }),
    };
    (gateway as any).principals = principals;
    const ws = mockWs();
    socks.push(ws);
    gateway.handleConnection(ws);
    ws.emit('message', Buffer.from(JSON.stringify({ type: 'auth', token: 't' })), false);
    await flush();
    ws.emit('message', Buffer.from(JSON.stringify({ type: 'connect', sessionId })), false);
    await flush();
    return ws;
  }

  beforeEach(() => {
    socks = [];
    serverProfiles = { assertCanConnect: jest.fn().mockResolvedValue(undefined), getDecryptedProfile: jest.fn() };
    manager = {
      isSessionRunning: jest.fn().mockReturnValue(true),
      attachWebSocket: jest.fn().mockReturnValue(true),
      detachWebSocket: jest.fn(),
    };
    const sessions = {
      findOne: jest.fn().mockImplementation(async (id: string) => ({
        id, serverProfileId: PROFILE, tmuxSessionId: 't', status: 'active', cols: 80, rows: 24,
      })),
    };
    gateway = new TerminalGateway(
      {} as any,
      serverProfiles as any,
      sessions as any,
      manager as any,
      { refuses: jest.fn().mockResolvedValue(false) } as any,
    );
  });

  afterEach(() => socks.forEach((ws) => gateway.handleDisconnect(ws)));

  const grant = (over: Record<string, unknown> = {}) =>
    ({ orgId: ORG, resourceType: 'server_profile', resourceId: PROFILE, ...over }) as any;

  it('detaches a revoked client with session_ended access_revoked', async () => {
    const ws = await attach('user-b', S1);
    serverProfiles.assertCanConnect.mockRejectedValue(new NotFoundException());
    await gateway.onGrantChanged(grant());
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'session_ended', reason: 'access_revoked' }));
    expect(manager.detachWebSocket).toHaveBeenCalledWith(S1, ws);
  });

  it('keeps a client that may still connect', async () => {
    const ws = await attach('user-b', S1);
    await gateway.onGrantChanged(grant());
    expect(manager.detachWebSocket).not.toHaveBeenCalled();
    expect(ws.send).not.toHaveBeenCalledWith(expect.stringContaining('access_revoked'));
  });

  it('ignores a grant on another resource type or profile', async () => {
    await attach('user-b', S1);
    serverProfiles.assertCanConnect.mockClear();
    await gateway.onGrantChanged(grant({ resourceType: 'note' }));
    await gateway.onGrantChanged(grant({ resourceId: 'other' }));
    expect(serverProfiles.assertCanConnect).not.toHaveBeenCalled();
  });

  it('member removal re-checks only that user; group deletion re-checks the org', async () => {
    await attach('user-b', S1);
    await attach('user-c', S2);
    serverProfiles.assertCanConnect.mockClear();
    await gateway.onMemberRemoved({ orgId: ORG, userId: 'user-b' } as any);
    expect(serverProfiles.assertCanConnect).toHaveBeenCalledTimes(1);
    serverProfiles.assertCanConnect.mockClear();
    await gateway.onGroupDeleted({ orgId: ORG } as any);
    expect(serverProfiles.assertCanConnect).toHaveBeenCalledTimes(2);
  });

  it('detaches on Forbidden and detaches only the revoked one of two', async () => {
    const wsB = await attach('user-b', S1);
    await attach('user-c', S1);
    serverProfiles.assertCanConnect.mockImplementation(async (_id: string, p: any) => {
      if (p.userId === 'user-b') throw new ForbiddenException();
    });
    await gateway.onGroupDeleted({ orgId: ORG } as any);
    expect(manager.detachWebSocket).toHaveBeenCalledTimes(1);
    expect(manager.detachWebSocket).toHaveBeenCalledWith(S1, wsB);
  });

  it('swallows unexpected errors and leaves the client attached', async () => {
    await attach('user-b', S1);
    serverProfiles.assertCanConnect.mockRejectedValue(new Error('db down'));
    await expect(gateway.onGrantChanged(grant())).resolves.toBeUndefined();
    expect(manager.detachWebSocket).not.toHaveBeenCalled();
  });
});
