import {
  keystrokeSchema,
  keyShortcutSchema,
  DEFAULT_KEY_SHORTCUTS,
} from './terminal.user-settings';
import {
  DEFAULT_TERMINAL_SETTINGS,
  TERMINAL_USER_SETTINGS,
} from './terminal.user-settings';
import {
  composeUserSettingsPatchSchema,
  composeUserSettingsSchema,
} from '@marinoscar/platform-api/settings';

// The terminal namespace is registered by shellkeep.manifest (test/setup.ts),
// so the platform's composed schemas carry it.
const userSettingsSchema = composeUserSettingsSchema() as any;
const userSettingsPatchSchema = composeUserSettingsPatchSchema() as any;

// Base valid settings object reused across tests
const baseSettings = {
  theme: 'system' as const,
  profile: {
    imageSource: 'provider' as const,
    imageObjectId: null,
  },
};

// A stable valid UUID used across key-shortcut tests
const VALID_UUID = '11111111-1111-4111-8111-111111111101';

// =============================================================================
// keystrokeSchema
// =============================================================================

describe('keystrokeSchema', () => {
  describe('valid inputs', () => {
    it('accepts { modifiers: ["ctrl", "shift"], key: "c" }', () => {
      const result = keystrokeSchema.parse({ modifiers: ['ctrl', 'shift'], key: 'c' });
      expect(result).toEqual({ modifiers: ['ctrl', 'shift'], key: 'c' });
    });

    it('accepts { modifiers: [], key: "Escape" }', () => {
      const result = keystrokeSchema.parse({ modifiers: [], key: 'Escape' });
      expect(result).toEqual({ modifiers: [], key: 'Escape' });
    });

    it('requires modifiers (the platform refuses a .default() in a user namespace)', () => {
      expect(() => keystrokeSchema.parse({ key: 'Enter' })).toThrow();
    });
  });

  describe('invalid inputs', () => {
    it('rejects an unknown key (e.g. "NotAKey")', () => {
      expect(() =>
        keystrokeSchema.parse({ modifiers: [], key: 'NotAKey' }),
      ).toThrow();
    });

    it('rejects an unknown modifier (e.g. "nope")', () => {
      expect(() =>
        keystrokeSchema.parse({ modifiers: ['nope'], key: 'a' }),
      ).toThrow();
    });
  });
});

// =============================================================================
// keyShortcutSchema
// =============================================================================

describe('keyShortcutSchema', () => {
  describe('valid inputs', () => {
    it('accepts a shortcut with exactly 1 keystroke', () => {
      const result = keyShortcutSchema.parse({
        id: VALID_UUID,
        label: 'Escape',
        keystrokes: [{ modifiers: [], key: 'Escape' }],
      });
      expect(result.keystrokes).toHaveLength(1);
    });

    it('accepts a shortcut with exactly 3 keystrokes (max)', () => {
      const result = keyShortcutSchema.parse({
        id: VALID_UUID,
        label: 'Triple',
        keystrokes: [
          { modifiers: ['ctrl'], key: 'a' },
          { modifiers: ['shift'], key: 'b' },
          { modifiers: [], key: 'c' },
        ],
      });
      expect(result.keystrokes).toHaveLength(3);
    });
  });

  describe('invalid inputs', () => {
    it('rejects keystrokes: [] (must have at least 1)', () => {
      expect(() =>
        keyShortcutSchema.parse({
          id: VALID_UUID,
          label: 'Empty',
          keystrokes: [],
        }),
      ).toThrow();
    });

    it('rejects keystrokes of length 4 (max is 3)', () => {
      expect(() =>
        keyShortcutSchema.parse({
          id: VALID_UUID,
          label: 'Too many',
          keystrokes: [
            { modifiers: [], key: 'a' },
            { modifiers: [], key: 'b' },
            { modifiers: [], key: 'c' },
            { modifiers: [], key: 'd' },
          ],
        }),
      ).toThrow();
    });

    it('rejects an empty label', () => {
      expect(() =>
        keyShortcutSchema.parse({
          id: VALID_UUID,
          label: '',
          keystrokes: [{ modifiers: [], key: 'a' }],
        }),
      ).toThrow();
    });

    it('rejects a label of length 41 (max is 40)', () => {
      expect(() =>
        keyShortcutSchema.parse({
          id: VALID_UUID,
          label: 'a'.repeat(41),
          keystrokes: [{ modifiers: [], key: 'a' }],
        }),
      ).toThrow();
    });

    it('rejects a non-UUID id', () => {
      expect(() =>
        keyShortcutSchema.parse({
          id: 'not-a-uuid',
          label: 'Bad ID',
          keystrokes: [{ modifiers: [], key: 'a' }],
        }),
      ).toThrow();
    });
  });
});

// =============================================================================
// userSettingsSchema — terminal.keyShortcuts
// =============================================================================

describe('userSettingsSchema — terminal.keyShortcuts', () => {
  const makeShortcut = (index: number) => ({
    id: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111100`,
    label: `Key ${index}`,
    keystrokes: [{ modifiers: [] as string[], key: 'a' }],
  });

  it('accepts an array of 50 shortcuts (the maximum)', () => {
    const shortcuts = Array.from({ length: 50 }, (_, i) => makeShortcut(i + 1));
    const result = userSettingsSchema.parse({
      ...baseSettings,
      terminal: { showScrollButtons: true, keyShortcuts: shortcuts },
    });
    expect(result.terminal?.keyShortcuts).toHaveLength(50);
  });

  it('rejects an array of 51 shortcuts (exceeds max of 50)', () => {
    const shortcuts = Array.from({ length: 51 }, (_, i) => makeShortcut(i + 1));
    expect(() =>
      userSettingsSchema.parse({
        ...baseSettings,
        terminal: { showScrollButtons: true, keyShortcuts: shortcuts },
      }),
    ).toThrow();
  });

  it('parses successfully when keyShortcuts is absent (field is optional)', () => {
    const result = userSettingsSchema.parse({
      ...baseSettings,
      terminal: { showScrollButtons: false },
    });
    expect(result.terminal?.keyShortcuts).toBeUndefined();
  });
});

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

describe('DEFAULT_TERMINAL_SETTINGS', () => {
  it('contains showScrollButtons: true', () => {
    expect(DEFAULT_TERMINAL_SETTINGS.showScrollButtons).toBe(true);
  });

  it('contains keyShortcuts with the default shortcuts', () => {
    expect(DEFAULT_TERMINAL_SETTINGS.keyShortcuts).toEqual(DEFAULT_KEY_SHORTCUTS);
  });

  it('satisfies the user settings schema so it can be stored without a validation error', () => {
    expect(() =>
      userSettingsSchema.parse({ ...baseSettings, terminal: DEFAULT_TERMINAL_SETTINGS }),
    ).not.toThrow();
  });
});

describe('TERMINAL_USER_SETTINGS.merge', () => {
  const merge = TERMINAL_USER_SETTINGS.merge;
  const custom = [
    {
      id: '22222222-2222-4222-8222-222222222201',
      label: 'Ctrl+B',
      keystrokes: [{ modifiers: ['ctrl' as const], key: 'b' as const }],
    },
  ];

  it('keeps the current value when the patch does not name the namespace', () => {
    const current = { showScrollButtons: false, keyShortcuts: custom };
    expect(merge(current, undefined)).toBe(current);
    expect(merge(undefined, undefined)).toBeUndefined();
  });

  it('removes the namespace on null (JSON Merge Patch)', () => {
    expect(merge({ showScrollButtons: false }, null)).toBeUndefined();
  });

  it('merges a partial patch over the defaults for a user without the namespace', () => {
    expect(merge(undefined, { showScrollButtons: false })).toEqual({
      showScrollButtons: false,
      keyShortcuts: DEFAULT_KEY_SHORTCUTS,
    });
  });

  it('replaces the whole shortcut list and keeps showScrollButtons', () => {
    expect(
      merge({ showScrollButtons: false, keyShortcuts: DEFAULT_KEY_SHORTCUTS }, { keyShortcuts: custom }),
    ).toEqual({ showScrollButtons: false, keyShortcuts: custom });
  });
});
