import { NotFoundException } from '@nestjs/common';

import { SNIPPETS_PER_USER_MAX } from './snippets.constants';
import { SnippetsService } from './snippets.service';

const ORG = '11111111-2222-4333-8444-555555555555';
const ME = { userId: '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', orgId: ORG };
const OTHER = { userId: '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', orgId: ORG };

interface Row {
  id: string;
  userId: string;
  orgId: string;
  title: string;
  body: string;
  tags: string[];
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

/** An in-memory `snippet` delegate that honours the where clauses the service uses. */
function fakePrisma() {
  const rows: Row[] = [];
  let seq = 0;
  const match = (row: Row, where: any): boolean => {
    if (where.id !== undefined) {
      const ids = typeof where.id === 'string' ? [where.id] : where.id.in;
      if (!ids.includes(row.id)) return false;
    }
    if (where.userId !== undefined && row.userId !== where.userId) return false;
    if (where.orgId !== undefined && row.orgId !== where.orgId) return false;
    if (where.OR) {
      const text = where.OR[0].title.contains.toLowerCase();
      const hit = row.title.toLowerCase().includes(text) || row.body.toLowerCase().includes(text) || row.tags.includes(text);
      if (!hit) return false;
    }
    return true;
  };
  const snippet = {
    findMany: async ({ where, select }: any) => {
      const found = rows.filter((r) => match(r, where)).sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());
      return select ? found.map((r) => ({ id: r.id, position: r.position })) : found.map((r) => ({ ...r }));
    },
    findFirst: async ({ where }: any) => {
      const row = rows.find((r) => match(r, where));
      return row ? { ...row } : null;
    },
    count: async ({ where }: any) => rows.filter((r) => match(r, where)).length,
    aggregate: async ({ where }: any) => {
      const mine = rows.filter((r) => match(r, where));
      return { _max: { position: mine.length ? Math.max(...mine.map((r) => r.position)) : null } };
    },
    create: async ({ data }: any) => {
      const row: Row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, createdAt: new Date(seq * 1000), updatedAt: new Date(), ...data };
      rows.push(row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return { ...row };
    },
    deleteMany: async ({ where }: any) => {
      for (const row of rows.filter((r) => match(r, where))) rows.splice(rows.indexOf(row), 1);
      return { count: 1 };
    },
  };
  const prisma: any = { snippet, $transaction: async (fn: (t: unknown) => unknown) => fn({ snippet }) };
  return { prisma, rows };
}

describe('SnippetsService', () => {
  let rows: Row[];
  let service: SnippetsService;
  let audit: { record: jest.Mock };

  beforeEach(() => {
    const fake = fakePrisma();
    rows = fake.rows;
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new SnippetsService(fake.prisma, audit as any);
  });

  const add = (title: string, body = 'ls -la', tags: string[] = [], scope = ME) => service.create(scope, { title, body, tags });
  const titles = async (scope = ME, query?: string) => (await service.list(scope, query)).items.map((i) => i.title);

  it('creates at the end and lists in order', async () => {
    await add('one');
    await add('two');
    const third = await add('three');
    expect(third.position).toBe(2);
    expect(third.warning).toBeNull();
    expect(await titles()).toEqual(['one', 'two', 'three']);
  });

  it('searches the title, the body and the tags', async () => {
    await add('Disk usage', 'df -h');
    await add('Logs', 'journalctl -u app', ['systemd']);
    expect(await titles(ME, 'disk')).toEqual(['Disk usage']);
    expect(await titles(ME, 'JOURNALCTL')).toEqual(['Logs']);
    expect(await titles(ME, 'systemd')).toEqual(['Logs']);
    expect(await titles(ME, 'nothing')).toEqual([]);
  });

  it('keeps one user out of another user\'s snippets: list, update, delete and reorder', async () => {
    const mine = await add('mine');
    const theirs = await add('theirs', 'x', [], OTHER);
    expect(await titles(OTHER)).toEqual(['theirs']);
    await expect(service.update(OTHER, mine.id, { title: 'stolen' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(OTHER, mine.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.reorder(OTHER, [mine.id])).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.reorder(ME, [theirs.id])).rejects.toBeInstanceOf(NotFoundException);
    expect(await titles()).toEqual(['mine']);
  });

  it('updates the given fields and re-checks the body', async () => {
    const s = await add('t');
    const saved = await service.update(ME, s.id, { body: 'password=hunter22' });
    expect(saved.title).toBe('t');
    expect(saved.warning).toBe('looks-like-secret');
    expect((await service.update(ME, s.id, { body: 'echo hi' })).warning).toBeNull();
  });

  it('warns on a secret-looking body and still saves it', async () => {
    const saved = await add('db', 'mysql --password=hunter22');
    expect(saved.warning).toBe('looks-like-secret');
    expect(await titles()).toEqual(['db']);
  });

  it('refuses the 201st snippet', async () => {
    for (let i = 0; i < SNIPPETS_PER_USER_MAX; i += 1) {
      rows.push({ id: `id-${i}`, userId: ME.userId, orgId: ORG, title: 't', body: 'b', tags: [], position: i, createdAt: new Date(), updatedAt: new Date() });
    }
    await expect(add('too many')).rejects.toMatchObject({ response: { code: 'SNIPPET_LIMIT_REACHED' }, status: 409 });
  });

  it('renumbers after a delete', async () => {
    const a = await add('a');
    await add('b');
    await add('c');
    await service.remove(ME, a.id);
    expect((await service.list(ME)).items.map((i) => [i.title, i.position])).toEqual([
      ['b', 0],
      ['c', 1],
    ]);
  });

  it('reorders, keeps unnamed snippets after the named ones, and refuses a duplicate id', async () => {
    const a = await add('a');
    const b = await add('b');
    const c = await add('c');
    expect((await service.reorder(ME, [c.id, a.id])).items.map((i) => i.title)).toEqual(['c', 'a', 'b']);
    expect((await service.list(ME)).items.map((i) => i.position)).toEqual([0, 1, 2]);
    await expect(service.reorder(ME, [b.id, b.id])).rejects.toMatchObject({ response: { code: 'SNIPPET_ORDER_INVALID' }, status: 400 });
  });

  it('never puts a title, a body or a tag in an audit event', async () => {
    const s = await add('Secret title', 'mysql --password=hunter22', ['sensitive-tag']);
    await service.update(ME, s.id, { body: 'other body text' });
    await service.reorder(ME, [s.id]);
    await service.remove(ME, s.id);
    const logged = JSON.stringify(audit.record.mock.calls);
    expect(audit.record).toHaveBeenCalledTimes(4);
    for (const text of ['Secret title', 'hunter22', 'sensitive-tag', 'other body text']) expect(logged).not.toContain(text);
  });
});
