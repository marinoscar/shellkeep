// =============================================================================
// Runbooks and row-level security over a real database (issue #61)
// =============================================================================
//
// Forced row-level security isolates runbooks and their versions between
// organizations. A superuser (or BYPASSRLS role) ignores every policy, so the
// shared test database cannot prove this when the suite is connected as one.
// This suite builds its own database owned by an ORDINARY role
// (`createRlsDatabase`), whatever role the suite itself is connected as.
// Run with `npm run test:db`.
// =============================================================================

import { randomBytes } from 'node:crypto';

import { runInOrg } from '@marinoscar/platform-api/core';

import { createRlsDatabase, rlsServices, ORG_A, ORG_B, type RlsDatabase } from '../helpers/rls-database.helper';
import { resolveDbSuite } from '../helpers/db-test-support';

const { describeWithDb } = resolveDbSuite('runbooks-rls.db.spec');

const DEF = { schemaVersion: 1, steps: [{ id: 'c1', name: 'Disk', kind: 'command', command: 'df -h' }] };

describeWithDb('Runbooks isolation under row-level security (real Postgres)', () => {
  let db: RlsDatabase;
  let services: ReturnType<typeof rlsServices>;
  let runbookId: string;

  beforeAll(async () => {
    db = await createRlsDatabase('runbooks');
    services = rlsServices(db);
    await db.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      for (const [id, slug] of [[ORG_A, 'org-a'], [ORG_B, 'org-b']] as const) {
        await tx.organization.create({ data: { id, name: slug, slug } });
      }
      const runbook = await tx.runbook.create({ data: { orgId: ORG_A, name: 'rb-iso' } });
      runbookId = runbook.id;
      await tx.runbookVersion.create({
        data: {
          orgId: ORG_A,
          runbookId,
          version: 1,
          definition: DEF,
          definitionSha256: randomBytes(32).toString('hex'),
        },
      });
    });
  }, 120_000);

  afterAll(async () => {
    await services?.close();
    await db?.destroy();
  });

  it('shows a runbook and its versions only to the owning organization', async () => {
    const id = runbookId;
    const seenFromA = await runInOrg(services.prisma, { orgId: ORG_A }, async (tx) => ({
      runbooks: await tx.runbook.findMany({ where: { id } }),
      versions: await tx.runbookVersion.findMany({ where: { runbookId: id } }),
    }));
    expect(seenFromA.runbooks).toHaveLength(1);
    expect(seenFromA.versions).toHaveLength(1);

    // Org B's scope sees nothing of it, even asking by id, and cannot touch it.
    const seenFromB = await runInOrg(services.prisma, { orgId: ORG_B }, async (tx) => ({
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
      runInOrg(services.prisma, { orgId: ORG_B }, (tx) => tx.runbook.create({ data: { orgId: ORG_A, name: 'rb-forged' } })),
    ).rejects.toThrow();

    // The runbook is untouched.
    const intact = await runInOrg(services.prisma, { orgId: ORG_A }, (tx) => tx.runbook.findUniqueOrThrow({ where: { id } }));
    expect(intact.archivedAt).toBeNull();
  });
});
