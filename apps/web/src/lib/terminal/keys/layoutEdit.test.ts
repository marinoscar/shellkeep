import { describe, it, expect } from 'vitest';
import { DEFAULT_KEY_LAYOUT, type KeyLayout, type LayoutEntry } from './keyModel';
import {
  addEntry,
  catalogBySection,
  chordLabel,
  deleteGroup,
  entryLabel,
  formatHexBytes,
  groupCells,
  macroLabel,
  moveEntryToGroup,
  moveEntryWithin,
  moveGroup,
  newKeyId,
  removeEntry,
  toggleSpan,
  validateKeyLayout,
} from './layoutEdit';

const ids = (layout: KeyLayout) =>
  layout.groups.map((g) => g.keys.map((e) => ('id' in e ? e.id : e.key.label)));

const macro = (id: string, label = 'M'): LayoutEntry => ({
  key: { kind: 'macro', id, label, chords: [{ modifiers: ['ctrl'], key: 'b' }] },
});

const small: KeyLayout = {
  groups: [{ keys: [{ id: 'esc' }, { id: 'tab' }] }, { keys: [{ id: 'shift+tab' }, { id: 'ctrl' }] }],
};

describe('layout edits (#169)', () => {
  it('moves groups up and down and refuses past the ends', () => {
    const r = moveGroup(small, 1, -1);
    expect(r.ok && ids(r.layout)).toEqual([['shift+tab', 'ctrl'], ['esc', 'tab']]);
    expect(moveGroup(small, 0, -1).ok).toBe(false);
    expect(ids(small)).toEqual([['esc', 'tab'], ['shift+tab', 'ctrl']]); // input untouched
  });

  it('deletes a group', () => {
    const r = deleteGroup(small, 0);
    expect(r.ok && ids(r.layout)).toEqual([['shift+tab', 'ctrl']]);
  });

  it('adds a key within the 4-key and 4-cell caps', () => {
    const r = addEntry(small, 0, { id: 'up' });
    expect(r.ok && r.position).toEqual({ group: 0, index: 2 });
    // group 1 holds shift+tab (2) + ctrl (1): one free cell
    const wide = addEntry(small, 1, { id: 'backspace' });
    expect(wide).toEqual({ ok: false, error: 'Group 2 has 1 free cell; this key needs 2.' });
    const full: KeyLayout = { groups: [{ keys: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }, { id: 'f4' }] }] };
    expect(addEntry(full, 0, { id: 'f5' })).toEqual({ ok: false, error: 'Group 1 is full: at most 4 keys.' });
  });

  it('adds a key in a new group, up to 40 groups', () => {
    const r = addEntry(small, 'new', { id: 'f1' });
    expect(r.ok && ids(r.layout)[2]).toEqual(['f1']);
    const many: KeyLayout = { groups: Array.from({ length: 40 }, () => ({ keys: [{ id: 'esc' }] })) };
    expect(addEntry(many, 'new', { id: 'f1' })).toEqual({ ok: false, error: 'At most 40 groups.' });
  });

  it('refuses a 51st inline key', () => {
    const groups = Array.from({ length: 13 }, (_, g) => ({
      keys: Array.from({ length: 4 }, (_, k) => macro(newKeyId(), `m${g}-${k}`)),
    })).slice(0, 13);
    const layout: KeyLayout = { groups: [...groups.slice(0, 12), { keys: groups[12].keys.slice(0, 2) }] };
    expect(layout.groups.flatMap((g) => g.keys)).toHaveLength(50);
    expect(addEntry(layout, 'new', macro(newKeyId()))).toEqual({
      ok: false,
      error: 'At most 50 custom and macro keys per layout.',
    });
  });

  it('removes a key and drops a group left empty', () => {
    const r = removeEntry(small, { group: 0, index: 0 });
    expect(r.ok && ids(r.layout)).toEqual([['tab'], ['shift+tab', 'ctrl']]);
    const r2 = r.ok ? removeEntry(r.layout, { group: 0, index: 0 }) : r;
    expect(r2.ok && ids(r2.layout)).toEqual([['shift+tab', 'ctrl']]);
  });

  it('reorders within a group', () => {
    const r = moveEntryWithin(small, { group: 0, index: 0 }, 1);
    expect(r.ok && ids(r.layout)[0]).toEqual(['tab', 'esc']);
    expect(r.ok && r.position).toEqual({ group: 0, index: 1 });
    expect(moveEntryWithin(small, { group: 0, index: 1 }, 1).ok).toBe(false);
  });

  it('moves a key across groups, checking the target caps', () => {
    const r = moveEntryToGroup(small, { group: 0, index: 0 }, 1);
    expect(r.ok && ids(r.layout)).toEqual([['tab'], ['shift+tab', 'ctrl', 'esc']]);
    // shift+tab (2 cells) does not fit next to esc + tab + ... once the group is full
    const full: KeyLayout = { groups: [{ keys: [{ id: 'esc' }, { id: 'tab' }, { id: 'up' }] }, { keys: [{ id: 'shift+tab' }] }] };
    expect(moveEntryToGroup(full, { group: 1, index: 0 }, 0)).toEqual({
      ok: false,
      error: 'Group 1 has 1 free cell; this key needs 2.',
    });
  });

  it('moving down from the last group makes a new group; a source left empty is dropped', () => {
    const r = moveEntryToGroup(small, { group: 1, index: 1 }, 2);
    expect(r.ok && ids(r.layout)).toEqual([['esc', 'tab'], ['shift+tab'], ['ctrl']]);
    expect(r.ok && r.position).toEqual({ group: 2, index: 0 });
    const single: KeyLayout = { groups: [{ keys: [{ id: 'esc' }] }, { keys: [{ id: 'tab' }] }] };
    const up = moveEntryToGroup(single, { group: 1, index: 0 }, 0);
    expect(up.ok && ids(up.layout)).toEqual([['esc', 'tab']]);
    const down = moveEntryToGroup(single, { group: 0, index: 0 }, 1);
    expect(down.ok && ids(down.layout)).toEqual([['tab', 'esc']]);
    expect(down.ok && down.position).toEqual({ group: 0, index: 1 });
  });

  it('drops a key before another one in the same group', () => {
    const layout: KeyLayout = { groups: [{ keys: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }] }] };
    const r = moveEntryToGroup(layout, { group: 0, index: 2 }, 0, 0);
    expect(r.ok && ids(r.layout)).toEqual([['f3', 'f1', 'f2']]);
  });

  it('toggles a span, storing it only when it differs from the default', () => {
    const r = toggleSpan(small, { group: 0, index: 0 });
    expect(r.ok && r.layout.groups[0].keys[0]).toEqual({ id: 'esc', span: 2 });
    const back = r.ok ? toggleSpan(r.layout, { group: 0, index: 0 }) : r;
    expect(back.ok && back.layout.groups[0].keys[0]).toEqual({ id: 'esc' });
    const narrow = toggleSpan(small, { group: 1, index: 0 });
    expect(narrow.ok && narrow.layout.groups[1].keys[0]).toEqual({ id: 'shift+tab', span: 1 });
    const full: KeyLayout = { groups: [{ keys: [{ id: 'shift+tab' }, { id: 'esc' }, { id: 'tab' }] }] };
    expect(toggleSpan(full, { group: 0, index: 1 })).toEqual({
      ok: false,
      error: 'Group 1 has no free cell to widen this key.',
    });
  });
});

describe('labels and helpers (#169)', () => {
  it('lists the catalog by section', () => {
    const sections = Object.fromEntries(catalogBySection().map((s) => [s.section, s.keys.map((k) => k.id)]));
    expect(sections.modifiers).toEqual(['ctrl', 'alt', 'shift']);
    expect(sections.signals).toEqual(['ctrl+c', 'ctrl+d', 'ctrl+z', 'ctrl+\\']);
    expect(sections.function).toHaveLength(12);
    expect(sections.navigation).toContain('pgdn');
    expect(sections.keys).toEqual(['esc', 'tab', 'shift+tab', 'enter', 'backspace']);
    expect(sections.actions).toEqual(['ai', 'arrow-drag', 'attach-file', 'snippets']);
  });

  it('formats chords, macro labels and hex bytes', () => {
    expect(chordLabel({ modifiers: ['shift', 'ctrl'], key: 'b' })).toBe('Ctrl+Shift+B');
    expect(chordLabel({ modifiers: [], key: 'ArrowLeft' })).toBe('←');
    expect(macroLabel([{ modifiers: ['ctrl'], key: 'b' }, { modifiers: [], key: '%' }])).toBe('Ctrl+B %');
    expect(formatHexBytes('\x1b[1;5C')).toBe('1b 5b 31 3b 35 43');
    expect(entryLabel({ id: 'pgup' })).toBe('PgUp');
  });

  it('makes v4 UUIDs', () => {
    expect(newKeyId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('validateKeyLayout (#169)', () => {
  it('accepts the default layout', () => {
    expect(validateKeyLayout(DEFAULT_KEY_LAYOUT)).toEqual([]);
  });

  it('reports every cap the API enforces', () => {
    const id = newKeyId();
    const layout: KeyLayout = {
      groups: [
        { keys: [] },
        { keys: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }, { id: 'f4' }, { id: 'f5' }] },
        { keys: [{ id: 'shift+tab' }, { id: 'backspace' }, { id: 'esc' }] },
        { keys: [{ id: 'nope' }, macro(id, 'x'.repeat(41)), macro(id, 'dup')] },
        {
          keys: [
            { key: { kind: 'custom', id: newKeyId(), label: 'bad', sequence: '\\q' } },
            { key: { kind: 'macro', id: 'not-a-uuid', label: 'long', chords: Array(9).fill({ modifiers: [], key: 'a' }) } },
          ],
        },
      ],
    };
    const errors = validateKeyLayout(layout);
    expect(errors).toEqual(
      expect.arrayContaining([
        'Group 1 is empty.',
        'Group 2 has more than 4 keys.',
        'Group 3 takes more than 4 cells.',
        'Group 4: unknown key "nope".',
        'Group 4: A label is at most 40 characters.',
        'Group 4: "dup" has the id of another key.',
        'Group 5: "bad": Unknown escape \\q.',
        'Group 5: "long" has an invalid id.',
        'Group 5: "long" needs 1 to 8 chords.',
      ]),
    );
    expect(groupCells(layout.groups[2])).toBe(5);
  });
});
