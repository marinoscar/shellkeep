import type { AuthProviderInfo } from '@marinoscar/platform-web/identity/headless';
import type { SystemSettingsResponseBase } from '@marinoscar/platform-contract/settings';
import type { TerminalUserSettingsDocument } from '../../types';

/** `GET /api/system-settings` (issue #48): the platform base plus ShellKeep's namespaces. */
type MockSystemSettings = SystemSettingsResponseBase & Record<string, unknown>;

/** A user who never saved terminal preferences: no `terminal` namespace. */
export const mockUserSettings: TerminalUserSettingsDocument = {
  theme: 'system',
  profile: {
    imageSource: 'provider',
    imageObjectId: null,
  },
  updatedAt: '2024-01-01T00:00:00.000Z',
  version: 1,
};

export const mockSystemSettings: MockSystemSettings = {
  ui: {
    allowUserThemeOverride: true,
  },
  features: {},
  terminal: {
    detachAfterMinutes: 60,
    terminateDetachedAfterHours: 12,
    purgeTerminatedAfterDays: 3,
    doctorProbeProfileId: null,
  },
  security: {
    jwtAccessTtlMinutes: 15,
    refreshTtlDays: 14,
  },
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
  overrides: Partial<TerminalUserSettingsDocument> = {},
): TerminalUserSettingsDocument {
  return {
    ...mockUserSettings,
    ...overrides,
  };
}
