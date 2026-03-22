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
    it('should call markStaleSessions and purgeOldTerminatedSessions', async () => {
      (prisma.terminalSession.updateMany as jest.Mock).mockResolvedValue({
        count: 0,
      });
      (prisma.terminalSession.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      await task.handleCleanup();

      expect(prisma.terminalSession.updateMany).toHaveBeenCalled();
      expect(prisma.terminalSession.deleteMany).toHaveBeenCalled();
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

  describe('purgeOldTerminatedSessions', () => {
    it('should delete terminated sessions older than 30 days', async () => {
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

      // Verify the cutoff is approximately 30 days ago
      const cutoffTime = deleteCall.where.terminatedAt.lt.getTime();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      expect(cutoffTime).toBeGreaterThanOrEqual(
        beforeTime - thirtyDaysMs - 100,
      );
      expect(cutoffTime).toBeLessThanOrEqual(afterTime - thirtyDaysMs + 100);
    });
  });
});
