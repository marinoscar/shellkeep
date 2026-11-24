import { serverProfilesQuerySchema } from './dto/server-profiles-query.dto';
import { bulkTagsSchema, BULK_MAX_IDS } from './dto/bulk-tags.dto';
import { healthOf, hostKeyStateOf, listOrderBy, listWhere } from './server-profiles.service';

const VISIBLE = { userId: 'u1' };
const ID = '00000000-0000-4000-8000-000000000001';

describe('server list query (#79)', () => {
  it('reads a repeated, a single and a comma-separated tag the same way', () => {
    expect(serverProfilesQuerySchema.parse({ tag: ['prod', 'web'] }).tag).toEqual(['prod', 'web']);
    expect(serverProfilesQuerySchema.parse({ tag: 'prod' }).tag).toEqual(['prod']);
    expect(serverProfilesQuerySchema.parse({ tag: 'prod, web' }).tag).toEqual(['prod', 'web']);
  });

  it('accepts owner me, shared and group:<uuid> only', () => {
    expect(serverProfilesQuerySchema.parse({ owner: 'me' }).owner).toBe('me');
    expect(serverProfilesQuerySchema.parse({ owner: `group:${ID}` }).owner).toBe(`group:${ID}`);
    expect(serverProfilesQuerySchema.safeParse({ owner: 'group:x' }).success).toBe(false);
    expect(serverProfilesQuerySchema.safeParse({ owner: 'everyone' }).success).toBe(false);
  });

  it('refuses an unknown health, host-key state or sort', () => {
    expect(serverProfilesQuerySchema.safeParse({ health: 'maybe' }).success).toBe(false);
    expect(serverProfilesQuerySchema.safeParse({ hostKey: 'maybe' }).success).toBe(false);
    expect(serverProfilesQuerySchema.safeParse({ sort: 'password' }).success).toBe(false);
  });
});

describe('listWhere', () => {
  it('is only the visible scope without filters', () => {
    expect(listWhere(VISIBLE, {}, null)).toEqual({ AND: [VISIBLE] });
  });

  it('ANDs the text, every tag, the owning group, the health and the host key', () => {
    const where = listWhere(VISIBLE, { q: 'web', tag: ['prod', 'eu'], health: 'unreachable', hostKey: 'untrusted' }, ID);
    expect(where.AND).toEqual([
      VISIBLE,
      expect.objectContaining({ OR: expect.arrayContaining([{ username: { contains: 'web', mode: 'insensitive' } }]) }),
      { tags: { hasEvery: ['prod', 'eu'] } },
      { ownerGroupId: ID },
      { lastTestAt: { not: null }, lastTestOk: false },
      { fingerprint: null },
    ]);
  });

  it('keeps a trusted key with no stored refusal in the trusted filter', () => {
    const [, trusted] = listWhere(VISIBLE, { hostKey: 'trusted' }, null).AND as object[];
    expect(trusted).toEqual({
      fingerprint: { not: null },
      OR: [{ lastTestCode: null }, { lastTestCode: { not: 'HOST_KEY_MISMATCH' } }],
    });
  });
});

describe('listOrderBy', () => {
  it('defaults each sort to its natural direction and ends on the id', () => {
    expect(listOrderBy('name', undefined)).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    expect(listOrderBy('updatedAt', undefined)).toEqual([{ updatedAt: 'desc' }, { id: 'asc' }]);
    expect(listOrderBy('health', 'desc')[0]).toEqual({ lastTestOk: { sort: 'desc', nulls: 'last' } });
  });
});

describe('healthOf and hostKeyStateOf', () => {
  it('derives the health from the stored test', () => {
    expect(healthOf({ lastTestAt: null, lastTestOk: null })).toBe('unknown');
    expect(healthOf({ lastTestAt: new Date(), lastTestOk: null })).toBe('unknown');
    expect(healthOf({ lastTestAt: new Date(), lastTestOk: true })).toBe('reachable');
    expect(healthOf({ lastTestAt: new Date(), lastTestOk: false })).toBe('unreachable');
  });

  it('derives the host-key state', () => {
    expect(hostKeyStateOf({ fingerprint: null, lastTestCode: 'HOST_KEY_UNKNOWN' })).toBe('untrusted');
    expect(hostKeyStateOf({ fingerprint: 'SHA256:x', lastTestCode: null })).toBe('trusted');
    expect(hostKeyStateOf({ fingerprint: 'SHA256:x', lastTestCode: 'HOST_KEY_MISMATCH' })).toBe('mismatch');
  });
});

describe('bulkTagsSchema', () => {
  it(`caps the ids at ${BULK_MAX_IDS}`, () => {
    const ids = Array.from({ length: BULK_MAX_IDS + 1 }, () => ID);
    expect(bulkTagsSchema.safeParse({ ids, add: ['a'] }).success).toBe(false);
  });

  it('needs a tag to add or remove, and never the same one in both', () => {
    expect(bulkTagsSchema.safeParse({ ids: [ID] }).success).toBe(false);
    expect(bulkTagsSchema.safeParse({ ids: [ID], add: ['a'], remove: ['a'] }).success).toBe(false);
    expect(bulkTagsSchema.parse({ ids: [ID], remove: ['a'] })).toEqual({ ids: [ID], add: [], remove: ['a'] });
  });
});
