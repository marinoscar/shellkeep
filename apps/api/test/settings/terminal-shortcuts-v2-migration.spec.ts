/**
 * The one-shot conversion of `shortcuts.keyShortcuts` into the v2
 * `shortcuts.layout` (issue #165, `prisma/settings-migrations/terminal-shortcuts-v2.ts`).
 */
import { composeUserSettingsSchema } from '@marinoscar/platform-api/settings';
import {
  DEFAULT_LAYOUT_GROUPS,
  addKeyLayout,
  migrateKeyLayout,
  removeKeyLayout,
  revertKeyLayout,
} from '../../prisma/settings-migrations/terminal-shortcuts-v2';
import { DEFAULT_KEY_LAYOUT, DEFAULT_KEY_SHORTCUTS } from '../../src/terminal/settings/shortcuts.user-settings';
import { legacyShortcutsToDefaultLayout, legacyShortcutsToLayout } from '../../src/terminal/settings/keys/key-model';

const SHORTCUT = {
  id: '22222222-2222-4222-8222-222222222201',
  label: 'Ctrl+B',
  keystrokes: [{ modifiers: ['ctrl'], key: 'b' }],
};
const TWO = {
  id: '22222222-2222-4222-8222-222222222202',
  label: 'tmux next',
  keystrokes: [{ modifiers: ['ctrl'], key: 'b' }, { modifiers: [], key: 'o' }],
};
const BASE = { theme: 'dark', profile: { imageSource: 'provider', imageObjectId: null } };
const ROW = { ...BASE, shortcuts: { keyShortcuts: [SHORTCUT, TWO] } };

const pack = (layout: any) => layout.groups.slice(DEFAULT_KEY_LAYOUT.groups.length);
const macro = (s: { id: string; label: string; keystrokes: unknown }) => ({
  key: { kind: 'macro', id: s.id, label: s.label, chords: s.keystrokes },
});
const other = (n: number) => ({
  id: `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`,
  label: `K${n}`,
  keystrokes: [{ modifiers: ['alt'], key: 'q' }],
});

describe('addKeyLayout (forward)', () => {
  it('writes the default layout and appends the shortcuts it lacks, keeping keyShortcuts', () => {
    const next = addKeyLayout(ROW) as any;
    expect(next.shortcuts.keyShortcuts).toEqual([SHORTCUT, TWO]);
    expect(next.shortcuts.layout.groups.slice(0, DEFAULT_KEY_LAYOUT.groups.length)).toEqual(DEFAULT_KEY_LAYOUT.groups);
    // ctrl+b alone and the two-chord macro are not default keys (ctrl+b o IS the first tmux macro)
    expect(pack(next.shortcuts.layout)).toEqual([{ keys: [macro(SHORTCUT)] }]);
    expect(next.shortcuts.options).toEqual({ autoHideWithHardwareKeyboard: true, haptics: true, layoutVersion: 2 });
    expect(next.theme).toBe('dark');
  });

  it('gives exactly DEFAULT_KEY_LAYOUT for the v1 defaults', () => {
    const next = addKeyLayout({ shortcuts: { keyShortcuts: DEFAULT_KEY_SHORTCUTS } }) as any;
    expect(next.shortcuts.layout).toEqual(DEFAULT_KEY_LAYOUT);
  });

  it('matches the key model conversion the web uses', () => {
    const lists = [
      [...DEFAULT_KEY_SHORTCUTS, SHORTCUT, TWO],
      [SHORTCUT, TWO, other(1), other(2), other(3), other(4), other(5)],
      [],
      Array.from({ length: 50 }, (_, i) => ({ ...TWO, id: other(i).id, keystrokes: [{ modifiers: [], key: 'o' }, { modifiers: ['alt'], key: String(i % 10) }] })),
    ];
    for (const list of lists) {
      const next = addKeyLayout({ shortcuts: { keyShortcuts: list } }) as any;
      expect(next.shortcuts.layout).toEqual(legacyShortcutsToDefaultLayout(list as any));
    }
  });

  it('carries the same default layout as DEFAULT_KEY_LAYOUT', () => {
    expect(DEFAULT_LAYOUT_GROUPS).toEqual(DEFAULT_KEY_LAYOUT.groups);
  });

  it('appends custom entries after the defaults and drops duplicates of default keys', () => {
    const esc = { id: other(9).id, label: 'Escape again', keystrokes: [{ modifiers: [], key: 'Escape' }] };
    const f5 = { id: other(8).id, label: 'F5', keystrokes: [{ modifiers: [], key: 'F5' }] };
    const tmuxO = { id: other(7).id, label: 'Mine', keystrokes: [{ modifiers: ['ctrl'], key: 'b' }, { modifiers: [], key: 'o' }] };
    const list = [...DEFAULT_KEY_SHORTCUTS, esc, f5, tmuxO, other(1), other(2), other(3), other(4), other(5)];
    const next = addKeyLayout({ ...BASE, shortcuts: { keyShortcuts: list } }) as any;
    expect(pack(next.shortcuts.layout)).toEqual([
      { keys: [1, 2, 3, 4].map((n) => macro(other(n))) },
      { keys: [macro(other(5))] },
    ]);
    expect(() => composeUserSettingsSchema().parse(next)).not.toThrow();
  });

  it('keeps the caps: at most 40 groups and 50 inline keys', () => {
    const list = Array.from({ length: 50 }, (_, i) => ({
      id: other(i).id,
      label: `K${i}`,
      keystrokes: [{ modifiers: ['alt'], key: 'q' }, { modifiers: ['alt'], key: 'w' }],
    }));
    const next = addKeyLayout({ ...BASE, shortcuts: { keyShortcuts: list } }) as any;
    const keys = next.shortcuts.layout.groups.flatMap((g: any) => g.keys);
    expect(next.shortcuts.layout.groups.length).toBeLessThanOrEqual(40);
    expect(keys.filter((k: any) => 'key' in k).length).toBeLessThanOrEqual(50);
    expect(() => composeUserSettingsSchema().parse(next)).not.toThrow();
  });

  it('is idempotent: a converted row is left alone', () => {
    const once = addKeyLayout(ROW);
    expect(once).not.toBeNull();
    expect(addKeyLayout(once)).toBeNull();
  });

  it('leaves rows without a v1 list alone and keeps a layout the user saved', () => {
    expect(addKeyLayout({ theme: 'dark' })).toBeNull();
    expect(addKeyLayout({ shortcuts: {} })).toBeNull();
    expect(addKeyLayout(null)).toBeNull();
    const own = { groups: [{ keys: [{ id: 'esc' }, { id: 'ctrl' }] }] };
    expect(addKeyLayout({ shortcuts: { keyShortcuts: [SHORTCUT], layout: own } })).toBeNull();
  });

  it('gives an empty list the default layout and skips malformed entries', () => {
    expect((addKeyLayout({ shortcuts: { keyShortcuts: [] } }) as any).shortcuts.layout).toEqual(DEFAULT_KEY_LAYOUT);
    const next = addKeyLayout({ shortcuts: { keyShortcuts: [{ id: 1 }, SHORTCUT] } }) as any;
    expect(pack(next.shortcuts.layout)).toEqual([{ keys: [macro(SHORTCUT)] }]);
  });

  it('keeps stored options and sets the version marker', () => {
    const next = addKeyLayout({ shortcuts: { keyShortcuts: [], options: { autoHideWithHardwareKeyboard: false, haptics: true } } }) as any;
    expect(next.shortcuts.options).toEqual({ autoHideWithHardwareKeyboard: false, haptics: true, layoutVersion: 2 });
  });

  it('upgrades a row the earlier migration wrote, once', () => {
    const old = { ...ROW, shortcuts: { keyShortcuts: [SHORTCUT, TWO], layout: legacyShortcutsToLayout([SHORTCUT, TWO] as any) } };
    const upgraded = addKeyLayout(old) as any;
    expect(upgraded.shortcuts.layout).toEqual(legacyShortcutsToDefaultLayout([SHORTCUT, TWO] as any));
    expect(upgraded.shortcuts.options.layoutVersion).toBe(2);
    expect(addKeyLayout(upgraded)).toBeNull();
    // an empty old layout upgrades too; a missing keyShortcuts falls back to the layout's macros
    expect((addKeyLayout({ shortcuts: { keyShortcuts: [], layout: { groups: [] } } }) as any).shortcuts.layout).toEqual(DEFAULT_KEY_LAYOUT);
    const noList = addKeyLayout({ shortcuts: { layout: legacyShortcutsToLayout([SHORTCUT] as any) } }) as any;
    expect(pack(noList.shortcuts.layout)).toEqual([{ keys: [macro(SHORTCUT)] }]);
  });

  it('produces a document the registered schema accepts', () => {
    const next = addKeyLayout({ ...BASE, shortcuts: { keyShortcuts: [...DEFAULT_KEY_SHORTCUTS, SHORTCUT, TWO] } });
    expect(() => composeUserSettingsSchema().parse(next)).not.toThrow();
  });
});

describe('removeKeyLayout (inverse)', () => {
  it('drops layout and options, keeps the rest, and is idempotent', () => {
    const row = { shortcuts: { keyShortcuts: [SHORTCUT], layout: { groups: [] }, options: { haptics: true } } };
    const back = removeKeyLayout(row);
    expect(back).toEqual({ shortcuts: { keyShortcuts: [SHORTCUT] } });
    expect(removeKeyLayout(back)).toBeNull();
    expect(removeKeyLayout({ theme: 'dark' })).toBeNull();
  });

  it('round-trips a v1 row', () => {
    expect(removeKeyLayout(addKeyLayout(ROW))).toEqual(ROW);
  });
});

describe('migrateKeyLayout / revertKeyLayout (rows)', () => {
  function fakePrisma(rows: { id: string; value: unknown }[]) {
    const updates: { id: string; value: any; version: unknown }[] = [];
    const prisma = {
      userSettings: {
        findMany: jest.fn(async ({ cursor }: { cursor?: { id: string } }) => (cursor ? [] : rows)),
        update: jest.fn(async ({ where, data }: any) => {
          updates.push({ id: where.id, value: data.value, version: data.version });
        }),
      },
    };
    return { prisma: prisma as any, updates };
  }

  it('writes only the rows it changes, bumping their version', async () => {
    const { prisma, updates } = fakePrisma([
      { id: 'a', value: ROW },
      { id: 'b', value: { theme: 'dark' } },
    ]);
    await expect(migrateKeyLayout(prisma)).resolves.toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('a');
    expect(updates[0].version).toEqual({ increment: 1 });
    // a second run over what it wrote changes nothing
    const again = fakePrisma([{ id: 'a', value: updates[0].value }]);
    await expect(migrateKeyLayout(again.prisma)).resolves.toBe(0);
  });

  it('reverts', async () => {
    const converted = addKeyLayout(ROW);
    const { prisma, updates } = fakePrisma([{ id: 'a', value: converted }]);
    await expect(revertKeyLayout(prisma)).resolves.toBe(1);
    expect(updates[0].value).toEqual(ROW);
  });
});
