import type { AuthProviderInfo } from '@marinoscar/platform-web/identity/headless';
import type { UserSettings, SystemSettings } from '../../types';

export const mockUserSettings: UserSettings = {
  theme: 'system',
  profile: {
    displayName: undefined,
    useProviderImage: true,
    customImageUrl: null,
  },
  updatedAt: '2024-01-01T00:00:00.000Z',
  version: 1,
};

export const mockSystemSettings: SystemSettings = {
  ui: {
    allowUserThemeOverride: true,
  },
  features: {},
  updatedAt: '2024-01-01T00:00:00.000Z',
  updatedBy: null,
  version: 1,
};

export const mockAuthProviders: AuthProviderInfo[] = [
  {
    name: 'google',
    authUrl: '/api/auth/google',
  },
];

// Helper to create variations
export function createMockUserSettings(
  overrides: Partial<UserSettings> = {},
): UserSettings {
  return {
    ...mockUserSettings,
    ...overrides,
  };
}
