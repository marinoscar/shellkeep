import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { TerminalWebhooksService } from './webhooks/terminal-webhooks.service';
import { SessionManagerService } from './session-manager.service';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_SINK } from '@marinoscar/platform-api/core';
import { AccessPolicy, PrincipalGroupsProvider } from '@marinoscar/platform-api/sharing';

describe('SessionsService', () => {
  let service: SessionsService;
  let prisma: PrismaService;

  const mockUserId = 'user-123';
  const mockOrgId = 'org-default';
  const mockScope = { userId: mockUserId, orgId: mockOrgId };
  /** The caller as AccessPolicy sees them. */
  const principalOf = (orgId: string) =>
    ({ kind: 'user', userId: mockUserId, email: 'person-a@example.test', credential: 'session', roles: [], permissions: ['sessions:write'], activeOrgId: orgId }) as any;
  const sessionManager = { terminateSession: jest.fn().mockResolvedValue(undefined) };
  const access = { require: jest.fn().mockResolvedValue({ allowed: true, role: 'operator', via: 'user_grant' }) };
  const auditSink = { record: jest.fn().mockResolvedValue(undefined) };
  const mockSessionId = 'session-456';
  const mockProfileId = 'profile-789';

  const mockServerProfile = {
    name: 'My Server',
    hostname: 'example.com',
    port: 22,
    username: 'admin',
  };

  const mockSession = {
    id: mockSessionId,
    userId: mockUserId,
    serverProfileId: mockProfileId,
    name: 'My Server-0115-1430',
    tmuxSessionId: 'sk-abcd1234',
    status: 'active',
    cols: 80,
    rows: 24,
    lastActivityAt: new Date('2025-01-15T14:30:00Z'),
    terminatedAt: null,
    createdAt: new Date('2025-01-15T14:30:00Z'),
    updatedAt: new Date('2025-01-15T14:30:00Z'),
    serverProfile: mockServerProfile,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: AUDIT_SINK, useValue: auditSink },
        { provide: AccessPolicy, useValue: access },
        { provide: SessionManagerService, useValue: sessionManager },
        { provide: PrincipalGroupsProvider, useValue: { enrich: async (principal: unknown) => principal } },
        { provide: TerminalWebhooksService, useValue: { sessionCreated: jest.fn(), sessionTerminated: jest.fn() } },
        {
          provide: PrismaService,
          useValue: {
            terminalSession: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              count: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            serverProfile: {
              findFirst: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      (prisma.terminalSession.findMany as jest.Mock).mockResolvedValue([
        mockSession,
      ]);
      (prisma.terminalSession.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll(mockScope, {
        page: 1,
        pageSize: 20,
        status: 'all',
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it('should filter by status when not "all"', async () => {
      (prisma.terminalSession.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.terminalSession.count as jest.Mock).mockResolvedValue(0);

      await service.findAll(mockScope, {
        page: 1,
        pageSize: 20,
        status: 'active',
      });

      expect(prisma.terminalSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: mockUserId, orgId: mockOrgId, status: 'active' },
        }),
      );
    });

    it('narrows to one server profile, still the caller\'s own sessions only (#79)', async () => {
      (prisma.terminalSession.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.terminalSession.count as jest.Mock).mockResolvedValue(0);
      const serverProfileId = '00000000-0000-4000-8000-000000000009';

      await service.findAll(mockScope, { page: 1, pageSize: 5, serverProfileId });

      expect(prisma.terminalSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: mockUserId, orgId: mockOrgId, serverProfileId } }),
      );
    });

    it('should not filter by status when "all"', async () => {
      (prisma.terminalSession.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.terminalSession.count as jest.Mock).mockResolvedValue(0);

      await service.findAll(mockScope, {
        page: 1,
        pageSize: 20,
        status: 'all',
      });

      expect(prisma.terminalSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: mockUserId, orgId: mockOrgId },
        }),
      );
    });

    it('should use default values for missing query params', async () => {
      (prisma.terminalSession.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.terminalSession.count as jest.Mock).mockResolvedValue(0);

      await service.findAll(mockScope, {});

      expect(prisma.terminalSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return session for correct user', async () => {
      (prisma.terminalSession.findFirst as jest.Mock).mockResolvedValue(
        mockSession,
      );

      const result = await service.findOne(mockSessionId, mockScope);

      expect(prisma.terminalSession.findFirst).toHaveBeenCalledWith({
        where: { id: mockSessionId, userId: mockUserId, orgId: mockOrgId },
        include: expect.any(Object),
      });
      expect(result.id).toBe(mockSessionId);
      expect(result.serverProfile).toEqual(mockServerProfile);
    });

    it('should throw NotFoundException when session not found', async () => {
      (prisma.terminalSession.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.findOne('nonexistent', mockScope),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should generate tmuxSessionId and auto-generate name', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue({
        id: mockProfileId,
        name: 'My Server',
        userId: mockUserId,
      });
      (prisma.terminalSession.create as jest.Mock).mockResolvedValue(
        mockSession,
      );

      const result = await service.create(principalOf(mockOrgId), {
        serverProfileId: mockProfileId,
      });

      expect(prisma.terminalSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockUserId,
          orgId: 'org-default',
          serverProfileId: mockProfileId,
          tmuxSessionId: expect.stringMatching(/^sk-[a-f0-9]{8}$/),
          status: 'active',
          cols: 80,
          rows: 24,
        }),
        include: expect.any(Object),
      });
      expect(result.id).toBe(mockSessionId);
    });

    it('should use provided name when given', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue({
        id: mockProfileId,
        name: 'My Server',
        userId: mockUserId,
      });
      (prisma.terminalSession.create as jest.Mock).mockResolvedValue({
        ...mockSession,
        name: 'Custom Name',
      });

      await service.create(principalOf(mockOrgId), {
        serverProfileId: mockProfileId,
        name: 'Custom Name',
      });

      expect(prisma.terminalSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Custom Name',
        }),
        include: expect.any(Object),
      });
    });

    it('answers 404 and creates nothing when AccessPolicy refuses the connect (a profile that is not shared with the caller)', async () => {
      access.require.mockRejectedValueOnce(new NotFoundException('not found'));

      await expect(service.create(principalOf(mockOrgId), { serverProfileId: mockProfileId })).rejects.toThrow(NotFoundException);

      expect(access.require).toHaveBeenCalledWith(expect.anything(), 'connect', { type: 'server_profile', id: mockProfileId });
      expect(prisma.serverProfile.findFirst).not.toHaveBeenCalled();
      expect(prisma.terminalSession.create).not.toHaveBeenCalled();
    });

    it('creates the session for the CALLER on a profile another user owns, once they may connect', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue({ id: mockProfileId, name: 'Shared Server', userId: 'someone-else' });
      (prisma.terminalSession.create as jest.Mock).mockResolvedValue(mockSession);

      await service.create(principalOf(mockOrgId), { serverProfileId: mockProfileId });

      expect(prisma.terminalSession.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: mockUserId, serverProfileId: mockProfileId }) }),
      );
    });

    it('should throw NotFoundException when server profile not found', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.create(principalOf(mockOrgId), {
          serverProfileId: 'nonexistent-profile',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('terminate', () => {
    it('should set status to terminated and set terminatedAt', async () => {
      (prisma.terminalSession.findFirst as jest.Mock).mockResolvedValue(
        mockSession,
      );
      (prisma.terminalSession.update as jest.Mock).mockResolvedValue({
        ...mockSession,
        status: 'terminated',
        terminatedAt: new Date(),
      });

      const result = await service.terminate(mockSessionId, mockScope);

      expect(prisma.terminalSession.update).toHaveBeenCalledWith({
        where: { id: mockSessionId },
        data: {
          status: 'terminated',
          terminatedAt: expect.any(Date),
        },
        include: expect.any(Object),
      });
      expect(result.status).toBe('terminated');
    });

    it('closes the live connection after the row update', async () => {
      (prisma.terminalSession.findFirst as jest.Mock).mockResolvedValue(mockSession);
      (prisma.terminalSession.update as jest.Mock).mockResolvedValue({ ...mockSession, status: 'terminated' });

      await service.terminate(mockSessionId, mockScope);

      expect(sessionManager.terminateSession).toHaveBeenCalledWith(mockSessionId);
      expect((prisma.terminalSession.update as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        sessionManager.terminateSession.mock.invocationCallOrder[0],
      );
    });

    it('still succeeds when closing the live connection throws', async () => {
      (prisma.terminalSession.findFirst as jest.Mock).mockResolvedValue(mockSession);
      (prisma.terminalSession.update as jest.Mock).mockResolvedValue({ ...mockSession, status: 'terminated' });
      sessionManager.terminateSession.mockRejectedValueOnce(new Error('boom'));

      const result = await service.terminate(mockSessionId, mockScope);

      expect(result.status).toBe('terminated');
    });

    it('does not close a connection when the session is not found', async () => {
      (prisma.terminalSession.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.terminate(mockSessionId, mockScope)).rejects.toThrow(NotFoundException);
      expect(sessionManager.terminateSession).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for wrong user', async () => {
      (prisma.terminalSession.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.terminate(mockSessionId, { ...mockScope, userId: 'wrong-user' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateActivity', () => {
    it('should update lastActivityAt', async () => {
      (prisma.terminalSession.update as jest.Mock).mockResolvedValue(
        mockSession,
      );

      await service.updateActivity(mockSessionId);

      expect(prisma.terminalSession.update).toHaveBeenCalledWith({
        where: { id: mockSessionId },
        data: { lastActivityAt: expect.any(Date) },
      });
    });
  });

  describe('updateStatus', () => {
    it('should update status to detached', async () => {
      (prisma.terminalSession.update as jest.Mock).mockResolvedValue(
        mockSession,
      );

      await service.updateStatus(mockSessionId, 'detached');

      expect(prisma.terminalSession.update).toHaveBeenCalledWith({
        where: { id: mockSessionId },
        data: { status: 'detached' },
      });
    });

    it('should set terminatedAt when status is terminated', async () => {
      (prisma.terminalSession.update as jest.Mock).mockResolvedValue(
        mockSession,
      );

      await service.updateStatus(mockSessionId, 'terminated');

      expect(prisma.terminalSession.update).toHaveBeenCalledWith({
        where: { id: mockSessionId },
        data: {
          status: 'terminated',
          terminatedAt: expect.any(Date),
        },
      });
    });
  });

  describe('batchTerminate', () => {
    beforeEach(() => {
      (prisma.terminalSession.findMany as jest.Mock).mockResolvedValue([
        { id: mockSessionId },
        { id: 'session-999' },
      ]);
    });

    it('closes the live connection of each terminated session, after the update', async () => {
      (prisma.terminalSession.updateMany as jest.Mock).mockResolvedValue({ count: 2 });

      await service.batchTerminate([mockSessionId, 'session-999'], mockScope);

      expect(sessionManager.terminateSession).toHaveBeenCalledTimes(2);
      expect(sessionManager.terminateSession).toHaveBeenCalledWith(mockSessionId);
      expect(sessionManager.terminateSession).toHaveBeenCalledWith('session-999');
      expect((prisma.terminalSession.updateMany as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        sessionManager.terminateSession.mock.invocationCallOrder[0],
      );
    });

    it('still closes the rest and succeeds when one close throws', async () => {
      (prisma.terminalSession.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
      sessionManager.terminateSession.mockRejectedValueOnce(new Error('boom'));

      await expect(service.batchTerminate([mockSessionId, 'session-999'], mockScope)).resolves.toEqual({ terminated: 2 });
      expect(sessionManager.terminateSession).toHaveBeenCalledTimes(2);
    });

    it('closes nothing when no session matched', async () => {
      (prisma.terminalSession.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.terminalSession.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await service.batchTerminate([mockSessionId], mockScope);

      expect(sessionManager.terminateSession).not.toHaveBeenCalled();
    });

    it('should audit each terminated session', async () => {
      (prisma.terminalSession.updateMany as jest.Mock).mockResolvedValue({ count: 2 });

      await service.batchTerminate([mockSessionId, 'session-999'], mockScope);

      expect(auditSink.record).toHaveBeenCalledTimes(2);
      expect(auditSink.record).toHaveBeenCalledWith({
        action: 'terminal_session.terminate',
        actorUserId: mockUserId,
        targetType: 'terminal_session',
        targetId: 'session-999',
        meta: { batch: true },
      });
    });

    it('should call updateMany with correct where clause including userId, id in list, and status not terminated', async () => {
      const ids = [mockSessionId, 'session-999'];
      (prisma.terminalSession.updateMany as jest.Mock).mockResolvedValue({
        count: 2,
      });

      await service.batchTerminate(ids, mockScope);

      expect(prisma.terminalSession.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ids },
          userId: mockUserId,
          orgId: mockOrgId,
          status: { not: 'terminated' },
        },
        data: {
          status: 'terminated',
          terminatedAt: expect.any(Date),
        },
      });
    });

    it('should return the count of terminated sessions', async () => {
      const ids = [mockSessionId, 'session-999'];
      (prisma.terminalSession.updateMany as jest.Mock).mockResolvedValue({
        count: 2,
      });

      const result = await service.batchTerminate(ids, mockScope);

      expect(result).toEqual({ terminated: 2 });
    });

    it('should return zero when all requested sessions are already terminated', async () => {
      const ids = [mockSessionId];
      (prisma.terminalSession.updateMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      const result = await service.batchTerminate(ids, mockScope);

      expect(result).toEqual({ terminated: 0 });
    });

    it('should only terminate sessions owned by the requesting user', async () => {
      const ids = [mockSessionId];
      (prisma.terminalSession.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      await service.batchTerminate(ids, mockScope);

      expect(prisma.terminalSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: mockUserId, orgId: mockOrgId }),
        }),
      );
    });
  });
  describe('organization scope and audit', () => {
    const otherOrg = { userId: mockUserId, orgId: 'org-other' };

    it('names the organization next to the owner in every lookup (another organization is a 404)', async () => {
      (prisma.terminalSession.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne(mockSessionId, otherOrg)).rejects.toThrow(NotFoundException);

      expect(prisma.terminalSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockSessionId, userId: mockUserId, orgId: 'org-other' },
        }),
      );
    });

    it('creates a session in the organization of the scope and audits it', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue({ id: mockProfileId, name: 'My Server' });
      (prisma.terminalSession.create as jest.Mock).mockResolvedValue(mockSession);

      await service.create(principalOf('org-other'), { serverProfileId: mockProfileId });

      expect(prisma.serverProfile.findFirst).toHaveBeenCalledWith({
        where: { id: mockProfileId, orgId: 'org-other' },
      });
      expect(prisma.terminalSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: mockUserId, orgId: 'org-other' }),
        }),
      );
      expect(auditSink.record).toHaveBeenCalledWith({
        action: 'terminal_session.create',
        actorUserId: mockUserId,
        targetType: 'terminal_session',
        targetId: mockSessionId,
        meta: { serverProfileId: mockProfileId },
      });
    });

    it('audits a termination', async () => {
      (prisma.terminalSession.findFirst as jest.Mock).mockResolvedValue(mockSession);
      (prisma.terminalSession.update as jest.Mock).mockResolvedValue({ ...mockSession, status: 'terminated' });

      await service.terminate(mockSessionId, mockScope);

      expect(auditSink.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'terminal_session.terminate', targetId: mockSessionId }),
      );
    });
  });
});
