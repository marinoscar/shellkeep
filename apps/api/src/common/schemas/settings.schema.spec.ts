import {
  userSettingsSchema,
  userSettingsPatchSchema,
  keystrokeSchema,
  keyShortcutSchema,
} from './settings.schema';
import {
  DEFAULT_USER_SETTINGS,
  DEFAULT_KEY_SHORTCUTS,
} from '../types/settings.types';

// Base valid settings object reused across tests
const baseSettings = {
  theme: 'system' as const,
  profile: {
    useProviderImage: true,
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

    it('uses default empty array when modifiers is omitted', () => {
      const result = keystrokeSchema.parse({ key: 'Enter' });
      expect(result.modifiers).toEqual([]);
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

describe('DEFAULT_USER_SETTINGS', () => {
  it('contains terminal.showScrollButtons: true', () => {
    expect(DEFAULT_USER_SETTINGS.terminal?.showScrollButtons).toBe(true);
  });

  it('contains terminal.keyShortcuts with the default shortcuts', () => {
    expect(DEFAULT_USER_SETTINGS.terminal?.keyShortcuts).toEqual(
      DEFAULT_KEY_SHORTCUTS,
    );
  });

  it('satisfies userSettingsSchema', () => {
    // The defaults must be valid according to the schema so they can be safely
    // stored and returned without triggering a validation error.
    expect(() => userSettingsSchema.parse(DEFAULT_USER_SETTINGS)).not.toThrow();
  });
});
