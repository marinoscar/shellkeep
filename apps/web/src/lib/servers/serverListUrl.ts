/**
 * The Servers page's filters and sort, kept in the URL so a Home tile can deep-link
 * (`/servers?health=unreachable`, `/servers?hostKey=untrusted`) and a reload keeps the view (#79).
 *
 *   q        text over the name, hostname and username
 *   tag      repeatable; profiles carrying every tag
 *   owner    `me`, `shared` or `group:<id>`
 *   health   `reachable`, `unreachable` or `unknown`
 *   hostKey  `trusted`, `untrusted` or `mismatch`
 *   sort     `name`, `health` or `lastSession` (with `order`)
 *   new=1    opens the create dialog (onboarding #70); not a filter
 *
 * A value outside its vocabulary is dropped, never sent to the API.
 */

import type { ServerHealth, ServerHostKeyState } from '../../types';
import type { ServerProfilesQuery, ServerProfilesSort } from '../../services/terminal-api';

export interface ServerListUrlState {
  q: string;
  tags: string[];
  owner: string | null;
  health: ServerHealth | null;
  hostKey: ServerHostKeyState | null;
  sort: ServerProfilesSort | null;
  order: 'asc' | 'desc' | null;
}

export const HEALTH_VALUES: readonly ServerHealth[] = ['reachable', 'unreachable', 'unknown'];
export const HOST_KEY_VALUES: readonly ServerHostKeyState[] = ['trusted', 'untrusted', 'mismatch'];
const SORT_VALUES: readonly ServerProfilesSort[] = ['name', 'hostname', 'health', 'lastSession', 'updatedAt'];
const OWNER_PATTERN = /^(me|shared|group:[0-9a-f-]{36})$/i;

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | null =>
  value && (allowed as readonly string[]).includes(value) ? (value as T) : null;

/** The filter keys this module owns; anything else in the URL is left alone. */
const KEYS = ['q', 'tag', 'owner', 'health', 'hostKey', 'sort', 'order'] as const;

export function readServerListUrl(params: URLSearchParams): ServerListUrlState {
  const owner = params.get('owner');
  const order = params.get('order');
  return {
    q: params.get('q') ?? '',
    tags: [...new Set(params.getAll('tag').flatMap((tag) => tag.split(',')).map((tag) => tag.trim()).filter(Boolean))],
    owner: owner && OWNER_PATTERN.test(owner) ? owner : null,
    health: pick(params.get('health'), HEALTH_VALUES),
    hostKey: pick(params.get('hostKey'), HOST_KEY_VALUES),
    sort: pick(params.get('sort'), SORT_VALUES),
    order: order === 'asc' || order === 'desc' ? order : null,
  };
}

/** A copy of `params` with this state written in (empty values removed). */
export function writeServerListUrl(params: URLSearchParams, state: ServerListUrlState): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of KEYS) next.delete(key);
  if (state.q.trim()) next.set('q', state.q.trim());
  for (const tag of state.tags) next.append('tag', tag);
  if (state.owner) next.set('owner', state.owner);
  if (state.health) next.set('health', state.health);
  if (state.hostKey) next.set('hostKey', state.hostKey);
  if (state.sort) next.set('sort', state.sort);
  if (state.sort && state.order) next.set('order', state.order);
  return next;
}

/** The API query of a URL state, for one page. */
export function toServerProfilesQuery(
  state: ServerListUrlState,
  paging: { page: number; pageSize: number },
): ServerProfilesQuery {
  return {
    page: paging.page,
    pageSize: paging.pageSize,
    ...(state.q.trim() ? { q: state.q.trim() } : {}),
    ...(state.tags.length > 0 ? { tags: state.tags } : {}),
    ...(state.owner ? { owner: state.owner } : {}),
    ...(state.health ? { health: state.health } : {}),
    ...(state.hostKey ? { hostKey: state.hostKey } : {}),
    ...(state.sort ? { sort: state.sort, ...(state.order ? { order: state.order } : {}) } : {}),
  };
}

/** Whether any filter (not the sort) narrows the list. */
export function hasServerListFilters(state: ServerListUrlState): boolean {
  return !!(state.q.trim() || state.tags.length || state.owner || state.health || state.hostKey);
}
