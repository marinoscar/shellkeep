import { Test, TestingModule } from '@nestjs/testing';
import { SessionCleanupTask } from './session-cleanup.task';
import { PrismaService } from '../../prisma/prisma.service';

describe('SessionCleanupTask', () => {
  let task: SessionCleanupTask;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionCleanupTask,
        {
          provide: PrismaService,
          useValue: {
            terminalSession: {
              updateMany: jest.fn(),
              deleteMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    task = module.get<SessionCleanupTask>(SessionCleanupTask);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleCleanup', () => {
    it('should call markStaleSessions, terminateStaleDetachedSessions, and purgeOldTerminatedSessions', async () => {
      (prisma.terminalSession.updateMany as jest.Mock).mockResolvedValue({
        count: 0,
      });
      (prisma.terminalSession.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      await task.handleCleanup();

      expect(prisma.terminalSession.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.terminalSession.deleteMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('markStaleSessions', () => {
    it('should update active sessions older than 1 hour to detached', async () => {
      (prisma.terminalSession.updateMany as jest.Mock).mockResolvedValue({
        count: 3,
      });
      (prisma.terminalSession.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      const beforeTime = Date.now();
      await task.handleCleanup();
      const afterTime = Date.now();

      const updateCall = (prisma.terminalSession.updateMany as jest.Mock).mock
        .calls[0][0];

      expect(updateCall.where.status).toBe('active');
      expect(updateCall.data.status).toBe('detached');

      // Verify the cutoff is approximately 1 hour ago
      const cutoffTime = updateCall.where.lastActivityAt.lt.getTime();
      const oneHourMs = 60 * 60 * 1000;
      expect(cutoffTime).toBeGreaterThanOrEqual(beforeTime - oneHourMs - 100);
      expect(cutoffTime).toBeLessThanOrEqual(afterTime - oneHourMs + 100);
    });
  });

  describe('terminateStaleDetachedSessions', () => {
    it('should update detached sessions older than 12 hours to terminated', async () => {
      (prisma.terminalSession.updateMany as jest.Mock)
        .mockResolvedValueOnce({ count: 0 }) // markStaleSessions
        .mockResolvedValueOnce({ count: 2 }); // terminateStaleDetachedSessions
      (prisma.terminalSession.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      const beforeTime = Date.now();
      await task.handleCleanup();
      const afterTime = Date.now();

      const updateCall = (prisma.terminalSession.updateMany as jest.Mock).mock
        .calls[1][0];

      expect(updateCall.where.status).toBe('detached');
      expect(updateCall.data.status).toBe('terminated');
      expect(updateCall.data.terminatedAt).toBeInstanceOf(Date);

      // Verify the cutoff is approximately 12 hours ago
      const cutoffTime = updateCall.where.lastActivityAt.lt.getTime();
      const twelveHoursMs = 12 * 60 * 60 * 1000;
      expect(cutoffTime).toBeGreaterThanOrEqual(
        beforeTime - twelveHoursMs - 100,
      );
      expect(cutoffTime).toBeLessThanOrEqual(afterTime - twelveHoursMs + 100);
    });
  });

  describe('purgeOldTerminatedSessions', () => {
    it('should delete terminated sessions older than 3 days', async () => {
      (prisma.terminalSession.updateMany as jest.Mock).mockResolvedValue({
        count: 0,
      });
      (prisma.terminalSession.deleteMany as jest.Mock).mockResolvedValue({
        count: 5,
      });

      const beforeTime = Date.now();
      await task.handleCleanup();
      const afterTime = Date.now();

      const deleteCall = (prisma.terminalSession.deleteMany as jest.Mock).mock
        .calls[0][0];

      expect(deleteCall.where.status).toBe('terminated');

      // Verify the cutoff is approximately 3 days ago
      const cutoffTime = deleteCall.where.terminatedAt.lt.getTime();
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      expect(cutoffTime).toBeGreaterThanOrEqual(
        beforeTime - threeDaysMs - 100,
      );
      expect(cutoffTime).toBeLessThanOrEqual(afterTime - threeDaysMs + 100);
    });
  });
});
