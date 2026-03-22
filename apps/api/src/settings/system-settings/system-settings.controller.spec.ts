import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSettingsService } from './system-settings.service';

describe('SystemSettingsController', () => {
  let controller: SystemSettingsController;
  let mockSystemSettingsService: jest.Mocked<SystemSettingsService>;

  const adminUserId = 'admin-uuid';

  const mockSettings = {
    data: {
      ui: { allowUserThemeOverride: true, defaultTheme: 'system' },
    },
    version: 1,
    updatedAt: new Date().toISOString(),
    updatedById: adminUserId,
  };

  beforeEach(async () => {
    mockSystemSettingsService = {
      getSettings: jest.fn(),
      replaceSettings: jest.fn(),
      patchSettings: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SystemSettingsController],
      providers: [
        { provide: SystemSettingsService, useValue: mockSystemSettingsService },
      ],
    }).compile();

    controller = module.get<SystemSettingsController>(SystemSettingsController);
  });

  describe('getSettings', () => {
    it('should return system settings from service', async () => {
      mockSystemSettingsService.getSettings.mockResolvedValue(mockSettings as any);

      const result = await controller.getSettings();

      expect(result).toEqual(mockSettings);
      expect(mockSystemSettingsService.getSettings).toHaveBeenCalledTimes(1);
    });

    it('should propagate service errors', async () => {
      mockSystemSettingsService.getSettings.mockRejectedValue(new Error('DB error'));

      await expect(controller.getSettings()).rejects.toThrow('DB error');
    });
  });

  describe('replaceSettings', () => {
    it('should call service with dto and userId and return updated settings', async () => {
      const dto = { ui: { allowUserThemeOverride: false } } as any;
      mockSystemSettingsService.replaceSettings.mockResolvedValue(mockSettings as any);

      const result = await controller.replaceSettings(dto, adminUserId);

      expect(result).toEqual(mockSettings);
      expect(mockSystemSettingsService.replaceSettings).toHaveBeenCalledWith(dto, adminUserId);
    });

    it('should propagate BadRequestException on validation failure', async () => {
      const dto = { ui: { invalidField: 'bad' } } as any;
      mockSystemSettingsService.replaceSettings.mockRejectedValue(
        new BadRequestException('Validation error'),
      );

      await expect(controller.replaceSettings(dto, adminUserId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('patchSettings', () => {
    it('should call service with dto, userId, and undefined version when no if-match header', async () => {
      const dto = { ui: { allowUserThemeOverride: false } } as any;
      mockSystemSettingsService.patchSettings.mockResolvedValue(mockSettings as any);

      const result = await controller.patchSettings(dto, adminUserId, undefined);

      expect(result).toEqual(mockSettings);
      expect(mockSystemSettingsService.patchSettings).toHaveBeenCalledWith(
        dto,
        adminUserId,
        undefined,
      );
    });

    it('should parse if-match header as integer version and pass to service', async () => {
      const dto = { ui: { defaultTheme: 'dark' } } as any;
      mockSystemSettingsService.patchSettings.mockResolvedValue(mockSettings as any);

      const result = await controller.patchSettings(dto, adminUserId, '1');

      expect(result).toEqual(mockSettings);
      expect(mockSystemSettingsService.patchSettings).toHaveBeenCalledWith(dto, adminUserId, 1);
    });

    it('should propagate ConflictException on version mismatch', async () => {
      const dto = { ui: {} } as any;
      mockSystemSettingsService.patchSettings.mockRejectedValue(
        new ConflictException('Version conflict'),
      );

      await expect(controller.patchSettings(dto, adminUserId, '5')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should propagate BadRequestException on validation failure', async () => {
      const dto = {} as any;
      mockSystemSettingsService.patchSettings.mockRejectedValue(
        new BadRequestException('Validation error'),
      );

      await expect(controller.patchSettings(dto, adminUserId, undefined)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
