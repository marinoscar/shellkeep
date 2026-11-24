/**
 * The one-shot move of `terminal.keyShortcuts` to the `shortcuts` namespace
 * (issue #80, `prisma/settings-migrations/terminal-shortcuts.ts`), run by the
 * seed, and its inverse (the rollback).
 */
import {
  migrateTerminalShortcuts,
  moveTerminalShortcuts,
  restoreTerminalShortcuts,
  revertTerminalShortcuts,
} from '../../prisma/settings-migrations/terminal-shortcuts';
import { composeUserSettingsSchema } from '@marinoscar/platform-api/settings';

const SHORTCUT = {
  id: '22222222-2222-4222-8222-222222222201',
  label: 'Ctrl+B',
  keystrokes: [{ modifiers: ['ctrl'], key: 'b' }],
};

const LEGACY = {
  theme: 'dark',
  profile: { imageSource: 'provider', imageObjectId: null },
  terminal: { showScrollButtons: false, keyShortcuts: [SHORTCUT] },
};

describe('moveTerminalShortcuts (forward)', () => {
  it('moves the list into the shortcuts namespace and keeps the rest of terminal', () => {
    expect(moveTerminalShortcuts(LEGACY)).toEqual({
      theme: 'dark',
      profile: LEGACY.profile,
      terminal: { showScrollButtons: false },
      shortcuts: { keyShortcuts: [SHORTCUT] },
    });
  });

  it('produces a document the registered schema accepts', () => {
    expect(() => composeUserSettingsSchema().parse(moveTerminalShortcuts(LEGACY))).not.toThrow();
  });

  it('keeps an existing shortcuts namespace (written later) and drops the legacy copy', () => {
    const value = { ...LEGACY, shortcuts: { keyShortcuts: [] } };
    expect(moveTerminalShortcuts(value)).toEqual({
      ...LEGACY,
      terminal: { showScrollButtons: false },
      shortcuts: { keyShortcuts: [] },
    });
  });

  it('is a no-op on a row with nothing to move (idempotent)', () => {
    const moved = moveTerminalShortcuts(LEGACY);
    expect(moveTerminalShortcuts(moved)).toBeNull();
    expect(moveTerminalShortcuts({ theme: 'light', profile: {} })).toBeNull();
    expect(moveTerminalShortcuts(null)).toBeNull();
  });
});

describe('restoreTerminalShortcuts (inverse)', () => {
  it('maps a moved row back to its pre-#80 shape', () => {
    expect(restoreTerminalShortcuts(moveTerminalShortcuts(LEGACY))).toEqual(LEGACY);
  });

  it('keeps only the pre-#80 terminal fields', () => {
    const value = {
      theme: 'dark',
      profile: LEGACY.profile,
      terminal: { showScrollButtons: true, fontSize: 18, theme: 'light' },
      shortcuts: { keyShortcuts: [SHORTCUT] },
    };
    expect(restoreTerminalShortcuts(value)).toEqual({
      theme: 'dark',
      profile: LEGACY.profile,
      terminal: { showScrollButtons: true, keyShortcuts: [SHORTCUT] },
    });
  });

  it('is a no-op on a row without a shortcuts namespace', () => {
    expect(restoreTerminalShortcuts(LEGACY)).toBeNull();
  });
});

describe('migrateTerminalShortcuts / revertTerminalShortcuts', () => {
  function fakePrisma(rows: { id: string; value: unknown }[]) {
    const update = jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id)!;
      row.value = data.value;
      return row;
    });
    const findMany = jest.fn(async ({ cursor, take }: any) => {
      const start = cursor ? rows.findIndex((r) => r.id === cursor.id) + 1 : 0;
      return rows.slice(start, start + take).map((r) => ({ ...r }));
    });
    return { prisma: { userSettings: { findMany, update } } as any, update };
  }

  it('writes only the rows that change, bumping their version, and round-trips', async () => {
    const rows = [
      { id: 'a', value: structuredClone(LEGACY) },
      { id: 'b', value: { theme: 'light', profile: {} } },
    ];
    const { prisma, update } = fakePrisma(rows);

    expect(await migrateTerminalShortcuts(prisma)).toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: expect.objectContaining({ version: { increment: 1 } }),
    });
    expect(rows[0].value).toEqual(moveTerminalShortcuts(LEGACY));
    expect(await migrateTerminalShortcuts(prisma)).toBe(0);

    expect(await revertTerminalShortcuts(prisma)).toBe(1);
    expect(rows[0].value).toEqual(LEGACY);
  });
});
