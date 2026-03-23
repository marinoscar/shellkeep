import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SessionsService', () => {
  let service: SessionsService;
  let prisma: PrismaService;

  const mockUserId = 'user-123';
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

      const result = await service.findAll(mockUserId, {
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

      await service.findAll(mockUserId, {
        page: 1,
        pageSize: 20,
        status: 'active',
      });

      expect(prisma.terminalSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: mockUserId, status: 'active' },
        }),
      );
    });

    it('should not filter by status when "all"', async () => {
      (prisma.terminalSession.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.terminalSession.count as jest.Mock).mockResolvedValue(0);

      await service.findAll(mockUserId, {
        page: 1,
        pageSize: 20,
        status: 'all',
      });

      expect(prisma.terminalSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: mockUserId },
        }),
      );
    });

    it('should use default values for missing query params', async () => {
      (prisma.terminalSession.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.terminalSession.count as jest.Mock).mockResolvedValue(0);

      await service.findAll(mockUserId, {});

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

      const result = await service.findOne(mockSessionId, mockUserId);

      expect(prisma.terminalSession.findFirst).toHaveBeenCalledWith({
        where: { id: mockSessionId, userId: mockUserId },
        include: expect.any(Object),
      });
      expect(result.id).toBe(mockSessionId);
      expect(result.serverProfile).toEqual(mockServerProfile);
    });

    it('should throw NotFoundException when session not found', async () => {
      (prisma.terminalSession.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.findOne('nonexistent', mockUserId),
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

      const result = await service.create(mockUserId, {
        serverProfileId: mockProfileId,
      });

      expect(prisma.terminalSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: mockUserId,
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

      await service.create(mockUserId, {
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

    it('should throw NotFoundException when server profile not found', async () => {
      (prisma.serverProfile.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.create(mockUserId, {
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

      const result = await service.terminate(mockSessionId, mockUserId);

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

    it('should throw NotFoundException for wrong user', async () => {
      (prisma.terminalSession.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.terminate(mockSessionId, 'wrong-user'),
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
    it('should call updateMany with correct where clause including userId, id in list, and status not terminated', async () => {
      const ids = [mockSessionId, 'session-999'];
      (prisma.terminalSession.updateMany as jest.Mock).mockResolvedValue({
        count: 2,
      });

      await service.batchTerminate(ids, mockUserId);

      expect(prisma.terminalSession.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ids },
          userId: mockUserId,
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

      const result = await service.batchTerminate(ids, mockUserId);

      expect(result).toEqual({ terminated: 2 });
    });

    it('should return zero when all requested sessions are already terminated', async () => {
      const ids = [mockSessionId];
      (prisma.terminalSession.updateMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      const result = await service.batchTerminate(ids, mockUserId);

      expect(result).toEqual({ terminated: 0 });
    });

    it('should only terminate sessions owned by the requesting user', async () => {
      const ids = [mockSessionId];
      (prisma.terminalSession.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      await service.batchTerminate(ids, mockUserId);

      expect(prisma.terminalSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: mockUserId }),
        }),
      );
    });
  });
});
