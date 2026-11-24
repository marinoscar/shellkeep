import {
  DEFAULT_KEY_LAYOUT,
  DEFAULT_KEY_OPTIONS,
  DEFAULT_SHORTCUTS_SETTINGS,
  SHORTCUTS_USER_SETTINGS,
  shortcutsSettingsPatchSchema,
  shortcutsSettingsSchema,
} from './shortcuts.user-settings';
import { keyLayoutSchema } from './key-layout.schema';
import { MAX_INLINE_KEYS, MAX_KEY_GROUPS, MAX_MACRO_CHORDS } from './keys/key-model';

describe('shortcuts namespace: action shortcuts (#57)', () => {
  const binding = { modifiers: ['ctrl', 'shift'] as Array<'ctrl' | 'shift'>, key: 'a' as const };

  it('accepts a rebinding of terminal.aiAssist and rejects an unknown action id', () => {
    expect(shortcutsSettingsPatchSchema.safeParse({ actions: { 'terminal.aiAssist': binding } }).success).toBe(true);
    expect(shortcutsSettingsPatchSchema.safeParse({ actions: { 'terminal.other': binding } }).success).toBe(false);
  });

  it('accepts a rebinding of terminal.aiExplain (#58)', () => {
    const e = { modifiers: ['ctrl', 'shift'] as Array<'ctrl' | 'shift'>, key: 'e' as const };
    expect(shortcutsSettingsPatchSchema.safeParse({ actions: { 'terminal.aiExplain': e } }).success).toBe(true);
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

describe('shortcuts namespace v2: layout and options (#165)', () => {
  const uuid = (n: number) => `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`;
  const macro = (n: number, chords = 2) => ({
    key: {
      kind: 'macro' as const,
      id: uuid(n),
      label: `M${n}`,
      chords: Array.from({ length: chords }, () => ({ modifiers: ['ctrl' as const], key: 'b' })),
    },
  });
  const custom = (n: number, sequence = '\\x1b[A') => ({
    key: { kind: 'custom' as const, id: uuid(n), label: `C${n}`, sequence },
  });

  it('keeps the stored defaults a v1 document (no layout stored for a new user)', () => {
    expect(DEFAULT_SHORTCUTS_SETTINGS.layout).toBeUndefined();
    expect(shortcutsSettingsSchema.safeParse(DEFAULT_SHORTCUTS_SETTINGS).success).toBe(true);
  });

  it('accepts the default layout and options, in a put and a patch', () => {
    const body = { keyShortcuts: [], layout: DEFAULT_KEY_LAYOUT, options: DEFAULT_KEY_OPTIONS };
    expect(shortcutsSettingsSchema.safeParse(body).success).toBe(true);
    expect(shortcutsSettingsPatchSchema.safeParse({ layout: DEFAULT_KEY_LAYOUT }).success).toBe(true);
    expect(shortcutsSettingsPatchSchema.safeParse({ options: DEFAULT_KEY_OPTIONS }).success).toBe(true);
  });

  it('accepts a catalog id with a span override and inline keys', () => {
    const layout = { groups: [{ keys: [{ id: 'esc', span: 2 }, macro(1)] }, { keys: [custom(2)] }] };
    expect(keyLayoutSchema.safeParse(layout).success).toBe(true);
  });

  it.each([
    ['an unknown catalog id', { groups: [{ keys: [{ id: 'nope' }] }] }],
    ['a span of 3', { groups: [{ keys: [{ id: 'esc', span: 3 }] }] }],
    ['an empty group', { groups: [{ keys: [] }] }],
    ['five keys in a group', { groups: [{ keys: Array.from({ length: 5 }, () => ({ id: 'esc' })) }] }],
    ['more than four cells in a group', { groups: [{ keys: [{ id: 'shift+tab' }, { id: 'esc', span: 2 }, { id: 'tab' }] }] }],
    ['an entry with both an id and a key', { groups: [{ keys: [{ id: 'esc', ...macro(1) }] }] }],
    ['an unknown field', { groups: [], extra: 1 }],
    ['an invalid custom escape', { groups: [{ keys: [custom(1, '\\q')] }] }],
    ['an empty macro', { groups: [{ keys: [macro(1, 0)] }] }],
    ['a macro longer than the cap', { groups: [{ keys: [macro(1, MAX_MACRO_CHORDS + 1)] }] }],
    ['a macro chord with an unknown key', { groups: [{ keys: [{ key: { ...macro(1).key, chords: [{ modifiers: [], key: 'Nope' }] } }] }] }],
    ['a non-uuid inline id', { groups: [{ keys: [{ key: { ...macro(1).key, id: 'x' } }] }] }],
    ['a label over 40 characters', { groups: [{ keys: [{ key: { ...macro(1).key, label: 'x'.repeat(41) } }] }] }],
    ['a repeated inline id', { groups: [{ keys: [macro(1)] }, { keys: [macro(1)] }] }],
    ['too many groups', { groups: Array.from({ length: MAX_KEY_GROUPS + 1 }, () => ({ keys: [{ id: 'esc' }] })) }],
  ])('rejects %s', (_name, layout) => {
    expect(keyLayoutSchema.safeParse(layout).success).toBe(false);
  });

  it('caps the inline keys of a layout', () => {
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ keys: [custom(i + 1)] }));
    expect(keyLayoutSchema.safeParse({ groups: rows(MAX_INLINE_KEYS) }).success).toBe(MAX_INLINE_KEYS <= MAX_KEY_GROUPS);
    const tooMany = Array.from({ length: MAX_INLINE_KEYS + 1 }, (_, i) => custom(i + 1));
    const groups = [];
    for (let i = 0; i < tooMany.length; i += 4) groups.push({ keys: tooMany.slice(i, i + 4) });
    expect(keyLayoutSchema.safeParse({ groups }).success).toBe(false);
  });

  it('requires both option fields (no defaults in a user namespace)', () => {
    expect(shortcutsSettingsPatchSchema.safeParse({ options: { haptics: true } }).success).toBe(false);
  });

  it('merge keeps the layout and options when only the list changes, and sets them when patched', () => {
    const current = { keyShortcuts: [], layout: DEFAULT_KEY_LAYOUT, options: DEFAULT_KEY_OPTIONS };
    expect(SHORTCUTS_USER_SETTINGS.merge(current, { keyShortcuts: [] })).toEqual(current);
    const options = { autoHideWithHardwareKeyboard: false, haptics: false };
    expect(SHORTCUTS_USER_SETTINGS.merge(current, { options })).toEqual({ ...current, options });
    expect(SHORTCUTS_USER_SETTINGS.merge({ keyShortcuts: [] }, { layout: { groups: [] } })).toEqual({
      keyShortcuts: [],
      layout: { groups: [] },
    });
  });
});
