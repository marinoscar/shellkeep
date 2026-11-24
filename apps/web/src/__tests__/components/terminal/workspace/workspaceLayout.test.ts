import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_TABS,
  closePane,
  closeTab,
  moveTab,
  openTab,
  parseSplit,
  parseWorkspaceSearch,
  readStoredLayout,
  resolveLayout,
  serializeWorkspaceSearch,
  setSplitDirection,
  splitWith,
  unsplit,
  visiblePanes,
  workspaceHref,
  writeStoredLayout,
  type WorkspaceLayout,
} from '../../../../components/terminal/workspace/workspaceLayout';

const L = (tabs: string[], active: string, split: WorkspaceLayout['split'] = null): WorkspaceLayout => ({ tabs, active, split });

describe('workspace layout: the URL', () => {
  it('round-trips tabs and the split', () => {
    const layout = L(['a', 'b', 'c'], 'b', { dir: 'v', panes: ['b', 'c'] });
    expect(serializeWorkspaceSearch(layout)).toBe('tabs=a,b,c&split=v:b|c');
    expect(workspaceHref(layout)).toBe('/sessions/b?tabs=a,b,c&split=v:b|c');
    expect(resolveLayout('b', parseWorkspaceSearch('?tabs=a,b,c&split=v:b|c'), null)).toEqual(layout);
  });

  it('returns null without a tabs parameter', () => {
    expect(parseWorkspaceSearch('')).toBeNull();
    expect(parseWorkspaceSearch('?split=v:a|b')).toBeNull();
  });

  it('drops malformed, repeated and excess ids', () => {
    const many = Array.from({ length: MAX_TABS + 3 }, (_, i) => `s${i}`).join(',');
    expect(parseWorkspaceSearch(`?tabs=a,a,<x>,b,,${many}`)!.tabs).toHaveLength(MAX_TABS);
    expect(parseWorkspaceSearch('?tabs=a,a,<x>,b')!.tabs).toEqual(['a', 'b']);
  });

  it('rejects a malformed split or one whose panes are not open', () => {
    expect(parseSplit('x:a|b')).toBeNull();
    expect(parseSplit('v:a|a')).toBeNull();
    expect(parseSplit('v:a')).toBeNull();
    expect(resolveLayout('a', parseWorkspaceSearch('?tabs=a&split=v:a|z'), null).split).toBeNull();
  });

  it('adds the route id when the URL or the stored copy lacks it', () => {
    expect(resolveLayout('c', { tabs: ['a', 'b'], split: null }, null).tabs).toEqual(['a', 'b', 'c']);
    expect(resolveLayout('c', null, { tabs: ['a'], split: null }).tabs).toEqual(['a', 'c']);
    expect(resolveLayout('c', null, null)).toEqual(L(['c'], 'c'));
  });
});

describe('workspace layout: transitions', () => {
  it('opens, activates and caps tabs', () => {
    expect(openTab(L(['a'], 'a'), 'b')).toEqual(L(['a', 'b'], 'b'));
    expect(openTab(L(['a', 'b'], 'b'), 'a')).toEqual(L(['a', 'b'], 'a'));
    const full = L(Array.from({ length: MAX_TABS }, (_, i) => `s${i}`), 's0');
    const next = openTab(full, 'new');
    expect(next.tabs).toHaveLength(MAX_TABS);
    expect(next.tabs).toContain('s0');
    expect(next.tabs).not.toContain('s1');
  });

  it('closes tabs, moving to the neighbour or the split partner', () => {
    expect(closeTab(L(['a', 'b', 'c'], 'b'), 'b')).toEqual(L(['a', 'c'], 'a'));
    expect(closeTab(L(['a', 'b', 'c'], 'a'), 'a')).toEqual(L(['b', 'c'], 'b'));
    expect(closeTab(L(['a', 'b', 'c'], 'a', { dir: 'v', panes: ['a', 'c'] }), 'a')).toEqual(L(['b', 'c'], 'c'));
    expect(closeTab(L(['a'], 'a'), 'a')).toBeNull();
  });

  it('reorders tabs', () => {
    expect(moveTab(L(['a', 'b', 'c'], 'a'), 0, 2).tabs).toEqual(['b', 'c', 'a']);
    expect(moveTab(L(['a', 'b'], 'a'), 0, 5).tabs).toEqual(['a', 'b']);
  });

  it('splits, changes direction, closes a pane and unsplits', () => {
    const split = splitWith(L(['a', 'c'], 'a'), 'v', 'b');
    expect(split).toEqual(L(['a', 'b', 'c'], 'a', { dir: 'v', panes: ['a', 'b'] }));
    expect(visiblePanes(split)).toEqual(['a', 'b']);
    expect(visiblePanes({ ...split, active: 'c' })).toEqual(['c']);
    expect(setSplitDirection(split, 'h').split?.dir).toBe('h');
    expect(closePane(split, 'a')).toEqual(L(['a', 'b', 'c'], 'b'));
    expect(unsplit(split).split).toBeNull();
    expect(splitWith(split, 'v', 'a')).toBe(split);
  });
});

describe('workspace layout: the stored copy', () => {
  beforeEach(() => window.localStorage.clear());

  it('stores tab ids and the split only, per user', () => {
    writeStoredLayout('u1', L(['a', 'b'], 'a', { dir: 'h', panes: ['a', 'b'] }));
    expect(JSON.parse(window.localStorage.getItem('shellkeep.terminal.workspace.v1:u1')!)).toEqual({
      tabs: ['a', 'b'],
      split: 'h:a|b',
    });
    expect(readStoredLayout('u1')).toEqual({ tabs: ['a', 'b'], split: { dir: 'h', panes: ['a', 'b'] } });
    expect(readStoredLayout('u2')).toBeNull();
    writeStoredLayout('u1', null);
    expect(readStoredLayout('u1')).toBeNull();
  });

  it('survives storage that throws or holds garbage', () => {
    const original = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => {} },
    });
    try {
      expect(readStoredLayout('u1')).toBeNull();
      expect(() => writeStoredLayout('u1', L(['a'], 'a'))).not.toThrow();
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: original });
    }
    window.localStorage.setItem('shellkeep.terminal.workspace.v1:u1', '{not json');
    expect(readStoredLayout('u1')).toBeNull();
    expect(readStoredLayout(null)).toBeNull();
  });
});
