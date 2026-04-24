import {
  userSettingsSchema,
  userSettingsPatchSchema,
} from './settings.schema';
import { DEFAULT_USER_SETTINGS } from '../types/settings.types';

// Base valid settings object reused across tests
const baseSettings = {
  theme: 'system' as const,
  profile: {
    useProviderImage: true,
  },
};

describe('userSettingsSchema', () => {
  describe('terminal field — valid inputs', () => {
    it('accepts a full settings object with terminal: { showScrollButtons: true }', () => {
      const result = userSettingsSchema.parse({
        ...baseSettings,
        terminal: { showScrollButtons: true },
      });

      expect(result.terminal).toEqual({ showScrollButtons: true });
    });

    it('accepts a full settings object with terminal: { showScrollButtons: false }', () => {
      const result = userSettingsSchema.parse({
        ...baseSettings,
        terminal: { showScrollButtons: false },
      });

      expect(result.terminal).toEqual({ showScrollButtons: false });
    });

    it('accepts a settings object without a terminal field (backwards-compat)', () => {
      const result = userSettingsSchema.parse(baseSettings);

      expect(result.terminal).toBeUndefined();
    });
  });

  describe('terminal field — invalid inputs', () => {
    it('rejects terminal: { showScrollButtons: "yes" } (string, not boolean)', () => {
      expect(() =>
        userSettingsSchema.parse({
          ...baseSettings,
          terminal: { showScrollButtons: 'yes' },
        }),
      ).toThrow();
    });

    it('rejects terminal: {} (missing required showScrollButtons)', () => {
      expect(() =>
        userSettingsSchema.parse({
          ...baseSettings,
          terminal: {},
        }),
      ).toThrow();
    });
  });
});

describe('userSettingsPatchSchema', () => {
  it('accepts { terminal: { showScrollButtons: false } } as a valid partial', () => {
    // deepPartial() makes all nested fields optional, so showScrollButtons is
    // optional in patches — but when provided it must still be a boolean.
    const result = userSettingsPatchSchema.parse({
      terminal: { showScrollButtons: false },
    });

    expect(result.terminal?.showScrollButtons).toBe(false);
  });

  it('accepts { terminal: { showScrollButtons: true } } as a valid partial', () => {
    const result = userSettingsPatchSchema.parse({
      terminal: { showScrollButtons: true },
    });

    expect(result.terminal?.showScrollButtons).toBe(true);
  });

  it('accepts { terminal: {} } because deepPartial makes showScrollButtons optional', () => {
    // deepPartial() recursively makes all fields optional, so an empty terminal
    // object is valid in a PATCH context.
    const result = userSettingsPatchSchema.parse({ terminal: {} });

    expect(result.terminal).toEqual({});
  });

  it('still rejects terminal: { showScrollButtons: "yes" } even as a partial', () => {
    expect(() =>
      userSettingsPatchSchema.parse({
        terminal: { showScrollButtons: 'yes' },
      }),
    ).toThrow();
  });
});

describe('DEFAULT_USER_SETTINGS', () => {
  it('contains terminal: { showScrollButtons: true }', () => {
    expect(DEFAULT_USER_SETTINGS.terminal).toEqual({ showScrollButtons: true });
  });

  it('satisfies userSettingsSchema', () => {
    // The defaults must be valid according to the schema so they can be safely
    // stored and returned without triggering a validation error.
    expect(() => userSettingsSchema.parse(DEFAULT_USER_SETTINGS)).not.toThrow();
  });
});
