import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { UserSettingsController } from './user-settings.controller';
import { UserSettingsService } from './user-settings.service';

describe('UserSettingsController', () => {
  let controller: UserSettingsController;
  let mockUserSettingsService: jest.Mocked<UserSettingsService>;

  const userId = 'user-uuid';

  const mockSettings = {
    data: {
      theme: 'system',
      profile: {
        displayName: null,
        useProviderImage: true,
        customImageUrl: null,
      },
    },
    version: 1,
    updatedAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    mockUserSettingsService = {
      getSettings: jest.fn(),
      replaceSettings: jest.fn(),
      patchSettings: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserSettingsController],
      providers: [
        { provide: UserSettingsService, useValue: mockUserSettingsService },
      ],
    }).compile();

    controller = module.get<UserSettingsController>(UserSettingsController);
  });

  describe('getSettings', () => {
    it('should return user settings for the current user', async () => {
      mockUserSettingsService.getSettings.mockResolvedValue(mockSettings as any);

      const result = await controller.getSettings(userId);

      expect(result).toEqual(mockSettings);
      expect(mockUserSettingsService.getSettings).toHaveBeenCalledWith(userId);
    });

    it('should propagate service errors', async () => {
      mockUserSettingsService.getSettings.mockRejectedValue(new Error('DB error'));

      await expect(controller.getSettings(userId)).rejects.toThrow('DB error');
    });
  });

  describe('replaceSettings', () => {
    it('should call service with userId and dto and return updated settings', async () => {
      const dto = {
        theme: 'dark',
        profile: { displayName: 'Test User', useProviderImage: false, customImageUrl: null },
      } as any;
      mockUserSettingsService.replaceSettings.mockResolvedValue(mockSettings as any);

      const result = await controller.replaceSettings(userId, dto);

      expect(result).toEqual(mockSettings);
      expect(mockUserSettingsService.replaceSettings).toHaveBeenCalledWith(userId, dto);
    });

    it('should propagate BadRequestException on validation failure', async () => {
      const dto = { theme: 'invalid-theme' } as any;
      mockUserSettingsService.replaceSettings.mockRejectedValue(
        new BadRequestException('Validation error'),
      );

      await expect(controller.replaceSettings(userId, dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('patchSettings', () => {
    it('should call service with userId, dto, and undefined version when no if-match header', async () => {
      const dto = { theme: 'light' } as any;
      mockUserSettingsService.patchSettings.mockResolvedValue(mockSettings as any);

      const result = await controller.patchSettings(userId, dto, undefined);

      expect(result).toEqual(mockSettings);
      expect(mockUserSettingsService.patchSettings).toHaveBeenCalledWith(userId, dto, undefined);
    });

    it('should parse if-match header as integer version and pass to service', async () => {
      const dto = { theme: 'dark' } as any;
      mockUserSettingsService.patchSettings.mockResolvedValue(mockSettings as any);

      const result = await controller.patchSettings(userId, dto, '3');

      expect(result).toEqual(mockSettings);
      expect(mockUserSettingsService.patchSettings).toHaveBeenCalledWith(userId, dto, 3);
    });

    it('should propagate ConflictException on version mismatch', async () => {
      const dto = { theme: 'dark' } as any;
      mockUserSettingsService.patchSettings.mockRejectedValue(
        new ConflictException('Version conflict'),
      );

      await expect(controller.patchSettings(userId, dto, '2')).rejects.toThrow(ConflictException);
    });

    it('should propagate BadRequestException on validation failure', async () => {
      const dto = {} as any;
      mockUserSettingsService.patchSettings.mockRejectedValue(
        new BadRequestException('Validation error'),
      );

      await expect(controller.patchSettings(userId, dto, undefined)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
