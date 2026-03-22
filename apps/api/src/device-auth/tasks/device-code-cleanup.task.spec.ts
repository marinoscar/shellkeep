import { Test, TestingModule } from '@nestjs/testing';
import { DeviceCodeCleanupTask } from './device-code-cleanup.task';
import { DeviceAuthService } from '../device-auth.service';

describe('DeviceCodeCleanupTask', () => {
  let task: DeviceCodeCleanupTask;
  let deviceAuthService: DeviceAuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceCodeCleanupTask,
        {
          provide: DeviceAuthService,
          useValue: {
            cleanupExpiredCodes: jest.fn(),
          },
        },
      ],
    }).compile();

    task = module.get<DeviceCodeCleanupTask>(DeviceCodeCleanupTask);
    deviceAuthService = module.get<DeviceAuthService>(DeviceAuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleCleanup', () => {
    it('should call deviceAuthService.cleanupExpiredCodes', async () => {
      (deviceAuthService.cleanupExpiredCodes as jest.Mock).mockResolvedValue(0);

      await task.handleCleanup();

      expect(deviceAuthService.cleanupExpiredCodes).toHaveBeenCalledTimes(1);
    });

    it('should log the number of records removed when codes are cleaned up', async () => {
      (deviceAuthService.cleanupExpiredCodes as jest.Mock).mockResolvedValue(4);

      const logSpy = jest
        .spyOn((task as any).logger, 'log')
        .mockImplementation(() => undefined);

      await task.handleCleanup();

      expect(logSpy).toHaveBeenCalledWith(
        'Device code cleanup completed: 4 records removed',
      );
    });

    it('should log zero when no codes are removed', async () => {
      (deviceAuthService.cleanupExpiredCodes as jest.Mock).mockResolvedValue(0);

      const logSpy = jest
        .spyOn((task as any).logger, 'log')
        .mockImplementation(() => undefined);

      await task.handleCleanup();

      expect(logSpy).toHaveBeenCalledWith(
        'Device code cleanup completed: 0 records removed',
      );
    });

    it('should log an error and not rethrow when cleanupExpiredCodes throws', async () => {
      const error = new Error('Database connection lost');
      (deviceAuthService.cleanupExpiredCodes as jest.Mock).mockRejectedValue(
        error,
      );

      const errorSpy = jest
        .spyOn((task as any).logger, 'error')
        .mockImplementation(() => undefined);

      await expect(task.handleCleanup()).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        'Error during device code cleanup',
        error,
      );
    });
  });
});
