import { Test, TestingModule } from '@nestjs/testing';
import { UserSettingsService } from '../../settings/user-settings/user-settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import {
  DEFAULT_USER_SETTINGS,
  UserSettingsValue,
} from '../../common/types/settings.types';
import { DEFAULT_KEY_SHORTCUTS, KeyShortcut } from './terminal.user-settings';

// The terminal namespace through the base UserSettingsService: defaults merge
// on read, replace on PUT, merge on PATCH.
describe('UserSettingsService - terminal namespace', () => {
  let service: UserSettingsService;
  let mockPrisma: MockPrismaService;

  const mockUserId = 'user-123';

  const mockUserSettings = {
    id: 'settings-1',
    userId: mockUserId,
    value: DEFAULT_USER_SETTINGS as any,
    version: 1,
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserSettingsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UserSettingsService>(UserSettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSettings', () => {
    it('should return DEFAULT_KEY_SHORTCUTS when stored settings have no terminal field', async () => {
      const storedWithoutTerminal: UserSettingsValue = {
        theme: 'system',
        profile: { useProviderImage: true },
        // terminal is intentionally absent
      };

      mockPrisma.userSettings.findUnique.mockResolvedValue({
        ...mockUserSettings,
        value: storedWithoutTerminal as any,
      });

      const result = await service.getSettings(mockUserId);

      expect(result.terminal?.keyShortcuts).toEqual(DEFAULT_KEY_SHORTCUTS);
    });

    it('should preserve showScrollButtons and fill keyShortcuts when terminal exists but keyShortcuts is absent', async () => {
      const storedWithScrollOnly: UserSettingsValue = {
        theme: 'dark',
        profile: { useProviderImage: false },
        terminal: { showScrollButtons: false },
        // keyShortcuts absent
      };

      mockPrisma.userSettings.findUnique.mockResolvedValue({
        ...mockUserSettings,
        value: storedWithScrollOnly as any,
      });

      const result = await service.getSettings(mockUserId);

      expect(result.terminal?.showScrollButtons).toBe(false);
      expect(result.terminal?.keyShortcuts).toEqual(DEFAULT_KEY_SHORTCUTS);
    });

    it('should return custom keyShortcuts unchanged when stored settings include them', async () => {
      const customShortcut = {
        id: '22222222-2222-4222-8222-222222222201',
        label: 'Custom',
        keystrokes: [{ modifiers: ['ctrl' as const], key: 'z' as const }],
      };

      const storedWithCustom: UserSettingsValue = {
        theme: 'light',
        profile: { useProviderImage: true },
        terminal: {
          showScrollButtons: true,
          keyShortcuts: [customShortcut],
        },
      };

      mockPrisma.userSettings.findUnique.mockResolvedValue({
        ...mockUserSettings,
        value: storedWithCustom as any,
      });

      const result = await service.getSettings(mockUserId);

      expect(result.terminal?.keyShortcuts).toEqual([customShortcut]);
    });
  });

  describe('replaceSettings (PUT)', () => {
    it('should replace user settings including keyShortcuts', async () => {
      const customShortcut = {
        id: '33333333-3333-4333-8333-333333333301',
        label: 'My Key',
        keystrokes: [{ modifiers: ['ctrl' as const], key: 'k' as const }],
      };

      const newSettings: UserSettingsValue = {
        theme: 'dark',
        profile: { useProviderImage: true },
        terminal: {
          showScrollButtons: true,
          keyShortcuts: [customShortcut],
        },
      };

      mockPrisma.userSettings.upsert.mockResolvedValue({
        ...mockUserSettings,
        value: newSettings as any,
        version: 2,
      } as any);

      mockPrisma.user.update.mockResolvedValue({} as any);

      const result = await service.replaceSettings(mockUserId, newSettings);

      expect(result.terminal?.keyShortcuts).toEqual([customShortcut]);
      expect(result.version).toBe(2);
    });
  });

  describe('patchSettings (PATCH)', () => {
    beforeEach(() => {
      mockPrisma.userSettings.findUnique.mockResolvedValue(
        mockUserSettings as any,
      );
    });

    it('should patch terminal.keyShortcuts and persist the new list', async () => {
      const newShortcut: KeyShortcut = {
        id: '44444444-4444-4444-8444-444444444401',
        label: 'New',
        keystrokes: [{ modifiers: [], key: 'F1' }],
      };

      const updatedValue: UserSettingsValue = {
        theme: DEFAULT_USER_SETTINGS.theme,
        profile: DEFAULT_USER_SETTINGS.profile,
        terminal: {
          showScrollButtons: true,
          keyShortcuts: [newShortcut],
        },
      };

      mockPrisma.userSettings.update.mockResolvedValue({
        ...mockUserSettings,
        value: updatedValue as any,
        version: 2,
      } as any);

      mockPrisma.user.update.mockResolvedValue({} as any);

      const result = await service.patchSettings(mockUserId, {
        terminal: { keyShortcuts: [newShortcut] },
      });

      expect(result.terminal?.keyShortcuts).toEqual([newShortcut]);
      expect(result.version).toBe(2);
    });
  });
});
