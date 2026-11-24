import { describe, it, expect } from 'vitest';
import { DEFAULT_KEY_LAYOUT, type KeyLayout } from './keyModel';
import { encodeResolvedKey, popupOf, resolveKeyGroups, type KeyActionId } from './keyRow';
import { ALT_POPUP, ARROW_POPUP, CTRL_POPUP } from './popupKeys';

const none = new Set<KeyActionId>();
const all = new Set<KeyActionId>(['ai', 'arrow-drag', 'attach-file', 'snippets']);

describe('resolveKeyGroups (#167)', () => {
  it('keeps the layout order, kinds, labels and spans', () => {
    const groups = resolveKeyGroups(DEFAULT_KEY_LAYOUT, all);
    expect(groups).toHaveLength(DEFAULT_KEY_LAYOUT.groups.length);
    expect(groups[1].keys.map((k) => [k.catalogId, k.kind, k.label, k.span])).toEqual([
      ['shift+tab', 'key', 'Shift+Tab', 2],
      ['esc', 'key', 'Esc', 1],
      ['ctrl', 'modifier', 'Ctrl', 1],
    ]);
    const macro = groups[3].keys[0];
    expect(macro).toMatchObject({ kind: 'macro', label: 'Ctrl+B O', span: 2 });
    expect(groups[2].keys.every((k) => k.repeatable)).toBe(true);
  });

  it('leaves out the actions the host cannot run and drops a group left empty', () => {
    const groups = resolveKeyGroups(DEFAULT_KEY_LAYOUT, none);
    expect(groups[0].index).toBe(1);
    expect(groups.flatMap((g) => g.keys).some((k) => k.kind === 'action')).toBe(false);

    const some = resolveKeyGroups(DEFAULT_KEY_LAYOUT, new Set<KeyActionId>(['ai', 'attach-file']));
    expect(some[0].keys.map((k) => k.catalogId)).toEqual(['ai', 'attach-file']);
  });

  it('skips an unknown catalog id and honours a span override', () => {
    const layout: KeyLayout = { groups: [{ keys: [{ id: 'nope' }, { id: 'esc', span: 2 }] }] };
    const [group] = resolveKeyGroups(layout, none);
    expect(group.keys).toHaveLength(1);
    expect(group.keys[0]).toMatchObject({ catalogId: 'esc', span: 2 });
  });

  it('gives every key a unique uid, even a catalog key placed twice', () => {
    const layout: KeyLayout = { groups: [{ keys: [{ id: 'esc' }, { id: 'esc' }] }, { keys: [{ id: 'esc' }] }] };
    const uids = resolveKeyGroups(layout, none).flatMap((g) => g.keys.map((k) => k.uid));
    expect(new Set(uids).size).toBe(3);
  });
});

describe('encodeResolvedKey (#167)', () => {
  const layout: KeyLayout = {
    groups: [
      {
        keys: [
          { id: 'right' },
          { id: 'ctrl' },
          { id: 'ai' },
          { key: { kind: 'custom', id: '00000000-0000-4000-8000-000000000001', label: 'Bad', sequence: 'x\\' } },
        ],
      },
      {
        keys: [
          {
            key: {
              kind: 'macro',
              id: '00000000-0000-4000-8000-000000000002',
              label: 'Prefix up',
              chords: [
                { modifiers: ['ctrl'], key: 'b' },
                { modifiers: [], key: 'ArrowUp' },
              ],
            },
          },
          { key: { kind: 'custom', id: '00000000-0000-4000-8000-000000000003', label: 'Word', sequence: '\\e[1;5C' } },
        ],
      },
    ],
  };
  const [first, second] = resolveKeyGroups(layout, all);
  const [right, ctrl, ai, bad] = first.keys;
  const [macro, custom] = second.keys;

  it('a key follows the cursor mode and the armed modifiers', () => {
    expect(encodeResolvedKey(right)).toBe('\x1b[C');
    expect(encodeResolvedKey(right, { applicationCursor: true })).toBe('\x1bOC');
    expect(encodeResolvedKey(right, { modifiers: { ctrl: true }, applicationCursor: true })).toBe('\x1b[1;5C');
  });

  it('a macro sends its chords in order (cursor mode applies, armed modifiers do not)', () => {
    expect(encodeResolvedKey(macro, { modifiers: { alt: true } })).toBe('\x02\x1b[A');
    expect(encodeResolvedKey(macro, { applicationCursor: true })).toBe('\x02\x1bOA');
  });

  it('a custom key sends its parsed sequence', () => {
    expect(encodeResolvedKey(custom, { modifiers: { ctrl: true } })).toBe('\x1b[1;5C');
  });

  it('modifier and action keys, and an invalid custom key, send nothing', () => {
    expect(encodeResolvedKey(ctrl)).toBe('');
    expect(encodeResolvedKey(ai)).toBe('');
    expect(encodeResolvedKey(bad)).toBe('');
  });
});

describe('popupOf (#167)', () => {
  const [group] = resolveKeyGroups(
    { groups: [{ keys: [{ id: 'ctrl' }, { id: 'alt' }, { id: 'left' }, { id: 'esc' }] }] },
    none,
  );
  it('Ctrl, Alt and the arrows have pop-ups; other keys none', () => {
    expect(popupOf(group.keys[0])?.entries).toBe(CTRL_POPUP);
    expect(popupOf(group.keys[1])?.entries).toBe(ALT_POPUP);
    expect(popupOf(group.keys[2])?.entries).toBe(ARROW_POPUP);
    expect(popupOf(group.keys[3])).toBeNull();
  });
});
