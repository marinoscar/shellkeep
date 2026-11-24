// =============================================================================
// The terminal workspace's layout model (issue #77): which sessions are open as
// tabs, which one is active, and whether two of them share the screen as a
// split. Pure functions, so the URL round trip and every transition are tested
// without React.
//
// The URL is the source of truth: `/sessions/<active>?tabs=a,b,c&split=v:a|b`.
// A per-user localStorage copy (tab ids and the split only, never terminal
// output) restores the layout when the URL carries none, for example after the
// session list or the switcher links to a bare `/sessions/<id>`.
// =============================================================================

/** `v`: side by side (a vertical divider); `h`: top and bottom. */
export type SplitDirection = 'v' | 'h';

/** Two sessions shown together. At most two panes in this version. */
export interface WorkspaceSplit {
  dir: SplitDirection;
  panes: [string, string];
}

export interface WorkspaceLayout {
  /** The open sessions, in tab order. Never empty. */
  tabs: string[];
  /** The focused session: the route's `:id`, always one of `tabs`. */
  active: string;
  /** The split, or `null` for one pane. Both panes are open tabs. */
  split: WorkspaceSplit | null;
}

/** The most tabs the workspace keeps open (each holds a WebSocket). */
export const MAX_TABS = 12;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Whether `value` looks like a session id (a UUID, or a test's short id). */
export function isSessionId(value: string): boolean {
  return ID.test(value);
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (isSessionId(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out.slice(0, MAX_TABS);
}

/** Parse `v:a|b` (or `h:a|b`); `null` when malformed or the panes repeat. */
export function parseSplit(value: string | null | undefined): WorkspaceSplit | null {
  if (!value) return null;
  const match = /^([vh]):([^|]+)\|(.+)$/.exec(value);
  if (!match) return null;
  const [, dir, a, b] = match;
  if (!isSessionId(a) || !isSessionId(b) || a === b) return null;
  return { dir: dir as SplitDirection, panes: [a, b] };
}

/** The split's URL form, `v:a|b`. */
export function formatSplit(split: WorkspaceSplit): string {
  return `${split.dir}:${split.panes[0]}|${split.panes[1]}`;
}

/** What a URL or the stored copy says, before it is reconciled with the route. */
export interface PartialLayout {
  tabs: string[];
  split: WorkspaceSplit | null;
}

/** Read `?tabs=` and `?split=`; `null` when the URL carries no `tabs`. */
export function parseWorkspaceSearch(search: string): PartialLayout | null {
  const params = new URLSearchParams(search);
  const rawTabs = params.get('tabs');
  if (rawTabs === null) return null;
  return { tabs: uniqueIds(rawTabs.split(',')), split: parseSplit(params.get('split')) };
}

/** The `?tabs=...&split=...` string of a layout (without the `?`). */
export function serializeWorkspaceSearch(layout: WorkspaceLayout): string {
  const params = new URLSearchParams();
  params.set('tabs', layout.tabs.join(','));
  if (layout.split) params.set('split', formatSplit(layout.split));
  // Keep the separators readable in the address bar.
  return params.toString().replace(/%2C/gi, ',').replace(/%3A/gi, ':').replace(/%7C/gi, '|');
}

/** The route of a layout: `/sessions/<active>?tabs=...`. */
export function workspaceHref(layout: WorkspaceLayout): string {
  return `/sessions/${encodeURIComponent(layout.active)}?${serializeWorkspaceSearch(layout)}`;
}

function keepValidSplit(tabs: readonly string[], split: WorkspaceSplit | null): WorkspaceSplit | null {
  if (!split) return null;
  return tabs.includes(split.panes[0]) && tabs.includes(split.panes[1]) ? split : null;
}

/**
 * The layout for the route `/sessions/<activeId>`: the URL's tabs when it has
 * them, otherwise the stored copy with `activeId` added, otherwise one tab.
 */
export function resolveLayout(
  activeId: string,
  fromUrl: PartialLayout | null,
  fromStorage: PartialLayout | null,
): WorkspaceLayout {
  const source = fromUrl ?? fromStorage;
  if (!source) return { tabs: [activeId], active: activeId, split: null };
  let tabs = uniqueIds(source.tabs);
  if (!tabs.includes(activeId)) {
    tabs = tabs.length >= MAX_TABS ? [...tabs.slice(0, MAX_TABS - 1), activeId] : [...tabs, activeId];
  }
  return { tabs, active: activeId, split: keepValidSplit(tabs, source.split) };
}

/** Open `id` (if it is not open yet) and make it active. */
export function openTab(layout: WorkspaceLayout, id: string): WorkspaceLayout {
  if (layout.tabs.includes(id)) return { ...layout, active: id };
  // A full workspace drops its oldest tab that is neither active nor in the split.
  let tabs = [...layout.tabs];
  if (tabs.length >= MAX_TABS) {
    const drop = tabs.find((t) => t !== layout.active && !layout.split?.panes.includes(t));
    tabs = tabs.filter((t) => t !== drop);
  }
  tabs.push(id);
  return { tabs, active: id, split: keepValidSplit(tabs, layout.split) };
}

/** Make an open tab active. */
export function activateTab(layout: WorkspaceLayout, id: string): WorkspaceLayout {
  return layout.tabs.includes(id) ? { ...layout, active: id } : layout;
}

/**
 * Close a tab. A split that showed it collapses to one pane. Returns `null`
 * when it was the last tab (the workspace is empty).
 */
export function closeTab(layout: WorkspaceLayout, id: string): WorkspaceLayout | null {
  const index = layout.tabs.indexOf(id);
  if (index === -1) return layout;
  const tabs = layout.tabs.filter((t) => t !== id);
  if (tabs.length === 0) return null;
  let active = layout.active;
  if (active === id) {
    const partner = layout.split?.panes.find((p) => p !== id);
    active = partner ?? tabs[Math.max(0, index - 1)];
  }
  return { tabs, active, split: keepValidSplit(tabs, layout.split) };
}

/** Move the tab at `from` to `to` (drag to reorder). */
export function moveTab(layout: WorkspaceLayout, from: number, to: number): WorkspaceLayout {
  if (from === to || from < 0 || to < 0 || from >= layout.tabs.length || to >= layout.tabs.length) {
    return layout;
  }
  const tabs = [...layout.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved);
  return { ...layout, tabs };
}

/**
 * Split the active session with `otherId` (opened as a tab next to the active
 * one when it is not open yet). The active session is the first pane.
 */
export function splitWith(layout: WorkspaceLayout, dir: SplitDirection, otherId: string): WorkspaceLayout {
  if (otherId === layout.active) return layout;
  let tabs = layout.tabs;
  if (!tabs.includes(otherId)) {
    tabs = [...tabs];
    tabs.splice(tabs.indexOf(layout.active) + 1, 0, otherId);
    tabs = tabs.slice(0, MAX_TABS);
  }
  return { tabs, active: layout.active, split: { dir, panes: [layout.active, otherId] } };
}

/** Change the direction of the split the active session is in. */
export function setSplitDirection(layout: WorkspaceLayout, dir: SplitDirection): WorkspaceLayout {
  if (!layout.split) return layout;
  return { ...layout, split: { ...layout.split, dir } };
}

/** Close one pane of the split: the other pane remains, its session still a tab. */
export function closePane(layout: WorkspaceLayout, id: string): WorkspaceLayout {
  if (!layout.split || !layout.split.panes.includes(id)) return layout;
  const remaining = layout.split.panes.find((p) => p !== id) ?? layout.active;
  return { ...layout, active: remaining, split: null };
}

/** Remove the split, keeping both sessions as tabs. */
export function unsplit(layout: WorkspaceLayout): WorkspaceLayout {
  return layout.split ? { ...layout, split: null } : layout;
}

/**
 * The sessions on screen now: the split's two panes while the active session
 * is one of them, otherwise the active session alone.
 */
export function visiblePanes(layout: WorkspaceLayout): string[] {
  if (layout.split && layout.split.panes.includes(layout.active)) return [...layout.split.panes];
  return [layout.active];
}

/** Two layouts that render the same. */
export function sameLayout(a: WorkspaceLayout, b: WorkspaceLayout): boolean {
  return serializeWorkspaceSearch(a) === serializeWorkspaceSearch(b) && a.active === b.active;
}

// ---------------------------------------------------------------------------
// The per-user stored copy. Every access is wrapped: storage may be absent,
// full or blocked (a private window), and the workspace works without it.
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = 'shellkeep.terminal.workspace.v1:';

/** The stored layout of `userId`, or `null`. */
export function readStoredLayout(userId: string | null | undefined): PartialLayout | null {
  if (!userId) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + userId);
    if (!raw) return null;
    const value = JSON.parse(raw) as { tabs?: unknown; split?: unknown };
    if (!Array.isArray(value.tabs)) return null;
    const tabs = uniqueIds(value.tabs.filter((t): t is string => typeof t === 'string'));
    return { tabs, split: parseSplit(typeof value.split === 'string' ? value.split : null) };
  } catch {
    return null;
  }
}

/** Store `layout` for `userId`: tab ids and the split only. */
export function writeStoredLayout(userId: string | null | undefined, layout: WorkspaceLayout | null): void {
  if (!userId) return;
  try {
    if (!layout) {
      window.localStorage.removeItem(STORAGE_PREFIX + userId);
      return;
    }
    window.localStorage.setItem(
      STORAGE_PREFIX + userId,
      JSON.stringify({ tabs: layout.tabs, split: layout.split ? formatSplit(layout.split) : null }),
    );
  } catch {
    // Storage is a convenience; the URL still carries the layout.
  }
}
