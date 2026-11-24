import { UnprocessableEntityException } from '@nestjs/common';

import { TargetResolverService } from './target-resolver.service';

const ME = { userId: 'me', orgId: 'org-1' };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const profile = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n), userId: 'me', name: `srv-${n}`, hostname: `h${n}.example.test`, tags: [], fingerprint: 'SHA256:x',
  facts: { kernel: 'k', os: 'linux', has: [], prettyName: 'Debian 12' }, ...over,
});

describe('TargetResolverService', () => {
  let findMany: jest.Mock;
  let resolve: jest.Mock;
  let service: TargetResolverService;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    resolve = jest.fn().mockResolvedValue({ maxTargetsPerRun: 200 });
    service = new TargetResolverService({ serverProfile: { findMany } } as never, { resolveSystem: resolve } as never);
  });

  it('returns nothing, without a query, for an empty selector', async () => {
    const out = await service.resolve(ME, {});
    expect(out).toEqual({ targets: [], skipped: [], total: 0, capped: false, limit: 200 });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('unions ids and tags in the organization and subtracts exclude', async () => {
    findMany.mockResolvedValue([profile(1)]);
    await service.resolve(ME, { serverIds: [id(1)], tags: { any: ['web'], all: [] }, exclude: [id(2)] });
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ orgId: 'org-1', id: { notIn: [id(2)] } });
    expect(where.OR).toEqual([{ id: { in: [id(1)] } }, { tags: { hasSome: ['web'] } }]);
  });

  it('requires both tag rules when both are given', async () => {
    await service.resolve(ME, { tags: { any: ['a'], all: ['b'] } });
    expect(findMany.mock.calls[0][0].where.OR).toEqual([{ AND: [{ tags: { hasSome: ['a'] } }, { tags: { hasEvery: ['b'] } }] }]);
  });

  it('partitions by ownership: another user\'s server is skipped as forbidden, never a target', async () => {
    findMany.mockResolvedValue([profile(1), profile(2, { userId: 'someone-else' })]);
    const out = await service.resolve(ME, { serverIds: [id(1), id(2)] });
    expect(out.targets.map((t) => t.id)).toEqual([id(1)]);
    expect(out.skipped).toEqual([{ serverProfileId: id(2), reason: 'forbidden' }]);
  });

  it('reports a named server that does not exist as not_found, but not an excluded one', async () => {
    findMany.mockResolvedValue([profile(1)]);
    const out = await service.resolve(ME, { serverIds: [id(1), id(3), id(4)], exclude: [id(4)] });
    expect(out.skipped).toEqual([{ serverProfileId: id(3), reason: 'not_found' }]);
  });

  it('sorts by name then id, whatever order the database answers in', async () => {
    findMany.mockResolvedValue([profile(3, { name: 'b' }), profile(2, { name: 'a' }), profile(1, { name: 'b' }), profile(4, { name: 'A' })]);
    const out = await service.resolve(ME, { serverIds: [id(1)] });
    expect(out.targets.map((t) => t.id)).toEqual([id(4), id(2), id(1), id(3)]);
  });

  it('caps at runbooks.maxTargetsPerRun and says so', async () => {
    resolve.mockResolvedValue({ maxTargetsPerRun: 2 });
    findMany.mockResolvedValue([profile(1), profile(2), profile(3)]);
    const out = await service.resolve(ME, { serverIds: [id(1)] });
    expect(out).toMatchObject({ total: 3, capped: true, limit: 2 });
    expect(out.targets.map((t) => t.name)).toEqual(['srv-1', 'srv-2']);
    expect(resolve).toHaveBeenCalledWith('runbooks', { orgId: 'org-1' });
  });

  it('exposes host-key trust and the facts pretty name only', async () => {
    findMany.mockResolvedValue([profile(1), profile(2, { fingerprint: null, facts: null })]);
    const out = await service.resolve(ME, { serverIds: [id(1)] });
    expect(out.targets[0]).toEqual({ id: id(1), name: 'srv-1', hostname: 'h1.example.test', tags: [], hostKeyTrusted: true, facts: { prettyName: 'Debian 12' } });
    expect(out.targets[1]).toMatchObject({ hostKeyTrusted: false, facts: { prettyName: null } });
  });

  it('answers 422 RUNBOOK_TARGET_GROUPS_UNAVAILABLE for groupIds, before any query', async () => {
    await expect(service.resolve(ME, { groupIds: [id(9)] })).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.resolve(ME, { groupIds: [id(9)] })).rejects.toMatchObject({ response: { code: 'RUNBOOK_TARGET_GROUPS_UNAVAILABLE' } });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('falls back to the default cap when settings cannot be read', async () => {
    resolve.mockRejectedValue(new Error('down'));
    expect(await service.maxTargetsPerRun('org-1')).toBe(200);
  });
});
