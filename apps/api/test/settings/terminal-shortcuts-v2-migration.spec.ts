/**
 * The one-shot conversion of `shortcuts.keyShortcuts` into the v2
 * `shortcuts.layout` (issue #165, `prisma/settings-migrations/terminal-shortcuts-v2.ts`).
 */
import { composeUserSettingsSchema } from '@marinoscar/platform-api/settings';
import {
  addKeyLayout,
  migrateKeyLayout,
  removeKeyLayout,
  revertKeyLayout,
} from '../../prisma/settings-migrations/terminal-shortcuts-v2';
import { DEFAULT_KEY_SHORTCUTS } from '../../src/terminal/settings/shortcuts.user-settings';
import { legacyShortcutsToLayout } from '../../src/terminal/settings/keys/key-model';

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

describe('addKeyLayout (forward)', () => {
  it('adds a layout of macro keys and keeps keyShortcuts', () => {
    const next = addKeyLayout(ROW) as any;
    expect(next.shortcuts.keyShortcuts).toEqual([SHORTCUT, TWO]);
    expect(next.shortcuts.layout).toEqual({
      groups: [
        {
          keys: [
            { key: { kind: 'macro', id: SHORTCUT.id, label: 'Ctrl+B', chords: SHORTCUT.keystrokes } },
            { key: { kind: 'macro', id: TWO.id, label: 'tmux next', chords: TWO.keystrokes } },
          ],
        },
      ],
    });
    expect(next.theme).toBe('dark');
  });

  it('matches the key model conversion the web uses, for the default list too', () => {
    const list = [...DEFAULT_KEY_SHORTCUTS, SHORTCUT, TWO];
    const next = addKeyLayout({ shortcuts: { keyShortcuts: list } }) as any;
    expect(next.shortcuts.layout).toEqual(legacyShortcutsToLayout(list as any));
  });

  it('produces a document the registered schema accepts', () => {
    const list = [...DEFAULT_KEY_SHORTCUTS, SHORTCUT, TWO];
    const next = addKeyLayout({ ...BASE, shortcuts: { keyShortcuts: list } });
    expect(() => composeUserSettingsSchema().parse(next)).not.toThrow();
  });

  it('is idempotent: a converted row is left alone', () => {
    const once = addKeyLayout(ROW);
    expect(once).not.toBeNull();
    expect(addKeyLayout(once)).toBeNull();
  });

  it('leaves rows without a v1 list alone and keeps a stored layout', () => {
    expect(addKeyLayout({ theme: 'dark' })).toBeNull();
    expect(addKeyLayout({ shortcuts: {} })).toBeNull();
    expect(addKeyLayout(null)).toBeNull();
    expect(addKeyLayout({ shortcuts: { keyShortcuts: [SHORTCUT], layout: { groups: [] } } })).toBeNull();
  });

  it('gives an empty list an empty layout and skips malformed entries', () => {
    expect((addKeyLayout({ shortcuts: { keyShortcuts: [] } }) as any).shortcuts.layout).toEqual({ groups: [] });
    const next = addKeyLayout({ shortcuts: { keyShortcuts: [{ id: 1 }, SHORTCUT] } }) as any;
    expect(next.shortcuts.layout.groups[0].keys).toHaveLength(1);
  });

  it('keeps 50 shortcuts within the layout caps', () => {
    const list = Array.from({ length: 50 }, (_, i) => ({
      ...TWO,
      id: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`,
    }));
    const next = addKeyLayout({ ...BASE, shortcuts: { keyShortcuts: list } });
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
