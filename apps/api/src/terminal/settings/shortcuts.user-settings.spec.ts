import { SHORTCUTS_USER_SETTINGS, shortcutsSettingsPatchSchema, shortcutsSettingsSchema } from './shortcuts.user-settings';

describe('shortcuts namespace: action shortcuts (#57)', () => {
  const binding = { modifiers: ['ctrl', 'shift'] as Array<'ctrl' | 'shift'>, key: 'a' as const };

  it('accepts a rebinding of terminal.aiAssist and rejects an unknown action id', () => {
    expect(shortcutsSettingsPatchSchema.safeParse({ actions: { 'terminal.aiAssist': binding } }).success).toBe(true);
    expect(shortcutsSettingsPatchSchema.safeParse({ actions: { 'terminal.other': binding } }).success).toBe(false);
  });

  it('a stored row without actions is still valid', () => {
    expect(shortcutsSettingsSchema.safeParse({ keyShortcuts: [] }).success).toBe(true);
  });

  it('merge keeps actions when only keyShortcuts change, and sets them when patched', () => {
    const current = { keyShortcuts: [], actions: { 'terminal.aiAssist': binding } };
    expect(SHORTCUTS_USER_SETTINGS.merge(current, { keyShortcuts: [] })).toEqual(current);
    expect(SHORTCUTS_USER_SETTINGS.merge({ keyShortcuts: [] }, { actions: { 'terminal.aiAssist': binding } })).toEqual(current);
  });
});
