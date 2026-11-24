// =============================================================================
// Runbooks over a real database (issue #61)
// =============================================================================
//
// Boots the full `AppModule` against the migrated and seeded database and proves what a
// mocked client cannot: forced row-level security isolates runbooks and versions between
// organizations, the live-name index is case-insensitive and per organization, versions are
// append-only through the API, and the stale-If-Match and identical-definition rules hold end
// to end. Passes when POSTGRES_USER is the ordinary application role (`shellkeep_app`).
// Run with `npm run test:db`.
// =============================================================================

import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { runInOrg } from '@marinoscar/platform-api/core';

import { closeTestApp, createTestApp, TestContext } from '../helpers/test-app.helper';

const RUN = randomBytes(4).toString('hex');
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const DEF = { schemaVersion: 1, steps: [{ id: 'c1', name: 'Disk', kind: 'command', command: 'df -h' }] };
const DEF2 = { schemaVersion: 1, steps: [{ id: 'c1', name: 'Disk', kind: 'command', command: 'df -i' }] };
const DEF3 = { schemaVersion: 1, steps: [{ id: 'c1', name: 'Disk', kind: 'command', command: 'uptime' }] };

describe('Runbooks (real database)', () => {
  let context: TestContext;
  const emails: string[] = [];
  const orgIds: string[] = [];
  const server = () => context.app.getHttpServer();
  const bypass = (fn: (tx: any) => Promise<any>): Promise<any> =>
    context.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return fn(tx);
    });

  async function login(name: string) {
    const email = `${name}-${RUN}@example.test`;
    emails.push(email);
    const res = await request(server()).post('/api/auth/test/login').send({ email, role: 'contributor' }).expect(302);
    const token = new URL(res.headers.location).searchParams.get('token') as string;
    const me = await request(server()).get('/api/auth/me').set(bearer(token)).expect(200);
    return { token, userId: me.body.data.id as string };
  }

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
    context = await createTestApp({ useMockDatabase: false });
  });

  afterAll(async () => {
    await bypass(async (tx) => {
      await tx.runbookVersion.deleteMany({ where: { runbook: { name: { startsWith: `rb-${RUN}` } } } });
      await tx.runbook.deleteMany({ where: { name: { startsWith: `rb-${RUN}` } } });
      await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
    });
    await context.prisma.user.deleteMany({ where: { email: { in: emails } } });
    await closeTestApp(context);
  });

  it('versions through the API: 412 on stale, no version for an identical definition, history append-only', async () => {
    const user = await login('author');
    const name = `rb-${RUN}-versions`;
    const created = await request(server()).post('/api/runbooks').set(bearer(user.token)).send({ name, definition: DEF, changelog: 'first' }).expect(201);
    const id = created.body.data.id as string;
    expect(created.headers.etag).toBe('"v1"');
    const v1Sha = created.body.data.latestVersion.definitionSha256;

    const same = await request(server()).put(`/api/runbooks/${id}/definition`).set(bearer(user.token)).set('If-Match', '"v1"').send({ definition: DEF }).expect(200);
    expect(same.body.data.created).toBe(false);
    expect(same.headers.etag).toBe('"v1"');

    const next = await request(server()).put(`/api/runbooks/${id}/definition`).set(bearer(user.token)).set('If-Match', '"v1"').send({ definition: DEF2, changelog: 'inodes' }).expect(200);
    expect(next.body.data.created).toBe(true);
    expect(next.headers.etag).toBe('"v2"');

    await request(server()).put(`/api/runbooks/${id}/definition`).set(bearer(user.token)).set('If-Match', '"v1"').send({ definition: DEF3 }).expect(412);
    await request(server()).put(`/api/runbooks/${id}/definition`).set(bearer(user.token)).set('If-Match', '"v2"').send({ definition: DEF3 }).expect(200);

    const versions = await request(server()).get(`/api/runbooks/${id}/versions`).set(bearer(user.token)).expect(200);
    expect(versions.body.data.items.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    const first = await request(server()).get(`/api/runbooks/${id}/versions/1`).set(bearer(user.token)).expect(200);
    expect(first.body.data.definitionSha256).toBe(v1Sha);
    expect(first.body.data.definition.steps[0].command).toBe('df -h');
    await request(server()).get(`/api/runbooks/${id}/versions/9`).set(bearer(user.token)).expect(404);

    // No path rewrites history: version 1 is byte-identical after three saves.
    const row = await bypass((tx) => tx.runbookVersion.findFirstOrThrow({ where: { runbookId: id, version: 1 } }));
    expect(row.definitionSha256).toBe(v1Sha);
    expect(await bypass((tx) => tx.runbookVersion.count({ where: { runbookId: id } }))).toBe(3);
  });

  it('keeps live names unique per organization, case-insensitively, and frees one on archive', async () => {
    const user = await login('names');
    const name = `rb-${RUN}-Name`;
    const first = await request(server()).post('/api/runbooks').set(bearer(user.token)).send({ name, definition: DEF }).expect(201);
    const clash = await request(server()).post('/api/runbooks').set(bearer(user.token)).send({ name: name.toLowerCase(), definition: DEF }).expect(409);
    expect(clash.body.code).toBe('RUNBOOK_NAME_TAKEN');

    await request(server()).delete(`/api/runbooks/${first.body.data.id}`).set(bearer(user.token)).expect(204);
    const second = await request(server()).post('/api/runbooks').set(bearer(user.token)).send({ name, definition: DEF }).expect(201);
    const restore = await request(server()).post(`/api/runbooks/${first.body.data.id}/restore`).set(bearer(user.token)).expect(409);
    expect(restore.body.code).toBe('RUNBOOK_NAME_TAKEN');
    await request(server()).delete(`/api/runbooks/${second.body.data.id}`).set(bearer(user.token)).expect(204);
    await request(server()).post(`/api/runbooks/${first.body.data.id}/restore`).set(bearer(user.token)).expect(200);
  });

  it('isolates runbooks and versions between organizations under row-level security', async () => {
    const user = await login('isolation');
    const created = await request(server()).post('/api/runbooks').set(bearer(user.token)).send({ name: `rb-${RUN}-iso`, definition: DEF }).expect(201);
    const id = created.body.data.id as string;
    // Single-organization mode: the runbook lives in the default organization.
    const orgA = (await context.prisma.organization.findFirstOrThrow({ where: { isDefault: true } })).id;

    const orgB = await bypass((tx) => tx.organization.create({ data: { name: `Org B ${RUN}`, slug: `org-b-${RUN}` } }));
    orgIds.push(orgB.id);

    const prisma = context.prisma;
    const seenFromA = await runInOrg(prisma, { orgId: orgA }, async (tx) => ({
      runbooks: await tx.runbook.findMany({ where: { id } }),
      versions: await tx.runbookVersion.findMany({ where: { runbookId: id } }),
    }));
    expect(seenFromA.runbooks).toHaveLength(1);
    expect(seenFromA.versions).toHaveLength(1);

    // Org B's scope sees nothing of it, even asking by id, and cannot touch it.
    const seenFromB = await runInOrg(prisma, { orgId: orgB.id }, async (tx) => ({
      runbooks: await tx.runbook.findMany({ where: { id } }),
      versions: await tx.runbookVersion.findMany({ where: { runbookId: id } }),
      count: await tx.runbook.count(),
      archived: await tx.runbook.updateMany({ where: { id }, data: { archivedAt: new Date() } }),
      removed: await tx.runbookVersion.deleteMany({ where: { runbookId: id } }),
    }));
    expect(seenFromB.runbooks).toEqual([]);
    expect(seenFromB.versions).toEqual([]);
    expect(seenFromB.count).toBe(0);
    expect(seenFromB.archived.count).toBe(0);
    expect(seenFromB.removed.count).toBe(0);

    // A row cannot be written into another organization's scope.
    await expect(
      runInOrg(prisma, { orgId: orgB.id }, (tx) =>
        tx.runbook.create({ data: { orgId: orgA, name: `rb-${RUN}-forged` } }),
      ),
    ).rejects.toThrow();

    // The runbook is untouched.
    const intact = await bypass((tx) => tx.runbook.findUniqueOrThrow({ where: { id } }));
    expect(intact.archivedAt).toBeNull();
  });
});
