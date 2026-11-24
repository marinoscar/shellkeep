import { describe, it, expect } from 'vitest';
import {
  hasServerListFilters,
  readServerListUrl,
  toServerProfilesQuery,
  writeServerListUrl,
} from '../../../lib/servers/serverListUrl';
import { runPool } from '../../../lib/servers/runPool';

const GROUP = '00000000-0000-4000-8000-000000000001';

describe('serverListUrl (#79)', () => {
  it('reads the Home tiles\' links', () => {
    expect(readServerListUrl(new URLSearchParams('health=unreachable'))).toMatchObject({ health: 'unreachable', tags: [] });
    expect(readServerListUrl(new URLSearchParams('hostKey=untrusted'))).toMatchObject({ hostKey: 'untrusted' });
  });

  it('reads repeated and comma-separated tags, once each', () => {
    expect(readServerListUrl(new URLSearchParams('tag=prod&tag=web,prod')).tags).toEqual(['prod', 'web']);
  });

  it('drops values outside their vocabulary', () => {
    const state = readServerListUrl(new URLSearchParams('health=x&hostKey=y&owner=everyone&sort=password&order=up'));
    expect(state).toMatchObject({ health: null, hostKey: null, owner: null, sort: null, order: null });
    expect(readServerListUrl(new URLSearchParams(`owner=group:${GROUP}`)).owner).toBe(`group:${GROUP}`);
  });

  it('round-trips through the URL and keeps unrelated parameters', () => {
    const state = readServerListUrl(new URLSearchParams(`q=web&tag=prod&owner=me&health=reachable&hostKey=mismatch&sort=name&order=desc`));
    const written = writeServerListUrl(new URLSearchParams('new=1&tag=old'), state);
    expect(written.get('new')).toBe('1');
    expect(written.getAll('tag')).toEqual(['prod']);
    expect(readServerListUrl(written)).toEqual(state);
  });

  it('writes no order without a sort, and nothing for empty values', () => {
    const written = writeServerListUrl(new URLSearchParams(), {
      q: '  ',
      tags: [],
      owner: null,
      health: null,
      hostKey: null,
      sort: null,
      order: 'asc',
    });
    expect(written.toString()).toBe('');
  });

  it('builds the API query of one page', () => {
    const state = readServerListUrl(new URLSearchParams('tag=prod&health=unreachable&sort=lastSession'));
    expect(toServerProfilesQuery(state, { page: 2, pageSize: 50 })).toEqual({
      page: 2,
      pageSize: 50,
      tags: ['prod'],
      health: 'unreachable',
      sort: 'lastSession',
    });
    expect(hasServerListFilters(state)).toBe(true);
    expect(hasServerListFilters(readServerListUrl(new URLSearchParams('sort=name')))).toBe(false);
  });
});

describe('runPool', () => {
  it('never runs more than the limit at once and reports every item', async () => {
    let inFlight = 0;
    let peak = 0;
    const settled: string[] = [];
    await runPool(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      4,
      async (item) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        if (item === 'c') throw new Error('boom');
        return item;
      },
      (item, outcome) => settled.push(`${item}:${outcome.ok ? 'ok' : 'fail'}`),
    );
    expect(peak).toBe(4);
    expect(settled).toHaveLength(7);
    expect(settled).toContain('c:fail');
  });
});
