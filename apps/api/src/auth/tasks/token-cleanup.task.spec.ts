import { Test, TestingModule } from '@nestjs/testing';
import { TokenCleanupTask } from './token-cleanup.task';
import { AuthService } from '../auth.service';

describe('TokenCleanupTask', () => {
  let task: TokenCleanupTask;
  let authService: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenCleanupTask,
        {
          provide: AuthService,
          useValue: {
            cleanupExpiredTokens: jest.fn(),
          },
        },
      ],
    }).compile();

    task = module.get<TokenCleanupTask>(TokenCleanupTask);
    authService = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleCron', () => {
    it('should call authService.cleanupExpiredTokens', async () => {
      (authService.cleanupExpiredTokens as jest.Mock).mockResolvedValue(0);

      await task.handleCron();

      expect(authService.cleanupExpiredTokens).toHaveBeenCalledTimes(1);
    });

    it('should log the number of tokens removed when tokens are cleaned up', async () => {
      (authService.cleanupExpiredTokens as jest.Mock).mockResolvedValue(7);

      const logSpy = jest
        .spyOn((task as any).logger, 'log')
        .mockImplementation(() => undefined);

      await task.handleCron();

      expect(logSpy).toHaveBeenCalledWith(
        'Token cleanup completed: 7 tokens removed',
      );
    });

    it('should log zero when no tokens are removed', async () => {
      (authService.cleanupExpiredTokens as jest.Mock).mockResolvedValue(0);

      const logSpy = jest
        .spyOn((task as any).logger, 'log')
        .mockImplementation(() => undefined);

      await task.handleCron();

      expect(logSpy).toHaveBeenCalledWith(
        'Token cleanup completed: 0 tokens removed',
      );
    });
  });
});
