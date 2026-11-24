// =============================================================================
// Group ownership of server profiles and runbooks: the composite keys (issue #71)
// =============================================================================
//
// `server_profiles` and `runbooks` carry a nullable `owner_group_id` and a COMPOSITE foreign key
// `(org_id, owner_group_id) -> groups (id, org_id)`. A foreign-key check bypasses row-level
// security, so a plain key could let one organization point at another's group; the composite key
// cannot. Proven over a throwaway database owned by an ORDINARY role (`createRlsDatabase`), whatever
// role the suite runs as. Run with `npm run test:db`.
// =============================================================================

import { runAsSystem } from '@marinoscar/platform-api/core';

import { createRlsDatabase, rlsServices, ORG_A, ORG_B, type RlsDatabase } from '../helpers/rls-database.helper';
import { resolveDbSuite } from '../helpers/db-test-support';

const { describeWithDb } = resolveDbSuite('group-ownership.db.spec');

const USER_A = '33333333-3333-4333-8333-aaaaaaaaaaaa';

describeWithDb('Group ownership keys (real Postgres)', () => {
  let db: RlsDatabase;
  let services: ReturnType<typeof rlsServices>;
  let groupA: string;
  let groupB: string;

  const system = <R,>(fn: (tx: any) => Promise<R>): Promise<R> =>
    runAsSystem(services.system, 'migration-tooling', fn as never) as Promise<R>;

  beforeAll(async () => {
    db = await createRlsDatabase('groupown');
    services = rlsServices(db);
    await system(async (tx) => {
      for (const [id, slug] of [[ORG_A, 'org-a'], [ORG_B, 'org-b']] as const) {
        await tx.organization.create({ data: { id, name: slug, slug } });
      }
      await tx.user.create({ data: { id: USER_A, email: 'person-a@example.test' } });
      groupA = (await tx.group.create({ data: { orgId: ORG_A, name: 'Group Alpha' } })).id;
      groupB = (await tx.group.create({ data: { orgId: ORG_B, name: 'Group Beta' } })).id;
    });
  }, 120_000);

  afterAll(async () => {
    await services?.close();
    await db?.destroy();
  });

  const profile = (orgId: string, ownerGroupId: string | null) => ({
    userId: USER_A,
    orgId,
    ownerGroupId,
    name: 'srv',
    hostname: 'srv.example.test',
    username: 'ops',
    authMethod: 'agent' as const,
    tags: [],
  });

  it('accepts a server profile with no group, and one owned by a group of its own organization', async () => {
    await system(async (tx) => {
      await tx.serverProfile.create({ data: profile(ORG_A, null) });
      await tx.serverProfile.create({ data: profile(ORG_A, groupA) });
    });
  });

  it('refuses a server profile owned by a group of ANOTHER organization', async () => {
    await expect(system((tx) => tx.serverProfile.create({ data: profile(ORG_A, groupB) }))).rejects.toThrow(/foreign key/i);
  });

  it('refuses a runbook owned by a group of another organization, accepts its own', async () => {
    await system((tx) => tx.runbook.create({ data: { orgId: ORG_A, name: 'rb-own', ownerGroupId: groupA } }));
    await expect(system((tx) => tx.runbook.create({ data: { orgId: ORG_A, name: 'rb-other', ownerGroupId: groupB } }))).rejects.toThrow(/foreign key/i);
  });

  it('refuses to delete a group that still owns a row (NO ACTION), until the row is gone', async () => {
    await expect(system((tx) => tx.group.delete({ where: { id: groupA } }))).rejects.toThrow(/foreign key/i);
    await system(async (tx) => {
      await tx.serverProfile.deleteMany({ where: { ownerGroupId: groupA } });
      await tx.runbook.deleteMany({ where: { ownerGroupId: groupA } });
      await tx.group.delete({ where: { id: groupA } });
    });
  });

  it('lets an organization be deleted with its groups and runbooks in one statement (NO ACTION is checked at the end)', async () => {
    await system(async (tx) => {
      const group = await tx.group.create({ data: { orgId: ORG_B, name: 'Group Gamma' } });
      await tx.runbook.create({ data: { orgId: ORG_B, name: 'rb-gamma', ownerGroupId: group.id } });
    });
    await expect(system((tx) => tx.organization.delete({ where: { id: ORG_B } }))).resolves.toBeDefined();
    expect(await system((tx) => tx.runbook.count({ where: { orgId: ORG_B } }))).toBe(0);
  });
});
