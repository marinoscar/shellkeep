import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { RunbooksService, parseVersionEtag, versionEtag } from './runbooks.service';
import { definitionSha256 } from './schema/definition-hash';
import { runbookDefinitionSchema } from './schema/runbook-definition.schema';

// `runInOrg` is the platform's transaction helper; here it just hands the fake transaction to the callback.
jest.mock('@marinoscar/platform-api/core', () => ({
  ...jest.requireActual('@marinoscar/platform-api/core'),
  runInOrg: (_client: unknown, _scope: unknown, fn: (tx: unknown) => unknown) => fn((global as any).__tx),
}));

// The list helper is the sharing slice's (proven against a real database in test/sharing); here it only returns a where.
jest.mock('../platform/sharing/sharing-access', () => ({
  ...jest.requireActual('../platform/sharing/sharing-access'),
  accessibleListWhere: jest.fn().mockResolvedValue({ ownerUserId: 'user-1' }),
}));

// The caller: an authenticated user of organization `org-1` who holds every runbook permission.
const scope = {
  kind: 'user',
  userId: 'user-1',
  email: 'person-a@example.test',
  credential: 'session',
  roles: [],
  permissions: ['runbooks:read', 'runbooks:write', 'runbooks:run'],
  activeOrgId: 'org-1',
} as never;
const OWNER_DECISION = { allowed: true, role: 'owner', via: 'owner' };
const DEF = { schemaVersion: 1, steps: [{ id: 'c1', name: 'Disk', kind: 'command', command: 'df -h' }] };
const DEF2 = { schemaVersion: 1, steps: [{ id: 'c1', name: 'Disk', kind: 'command', command: 'df -i' }] };
const norm = (d: unknown) => runbookDefinitionSchema.parse(d);

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'rb-1', orgId: 'org-1', ownerUserId: 'user-1', ownerGroupId: null, owner: { id: 'user-1', displayName: 'Person A', email: 'person-a@example.test' }, ownerGroup: null,
    name: 'Patch', description: null, tags: [], latestVersionId: 'v-1', archivedAt: null, createdAt: new Date(0), updatedAt: new Date(0), ...over,
  };
}
function ver(version: number, def: unknown, over: Record<string, unknown> = {}) {
  return {
    id: `v-${version}`, orgId: 'org-1', runbookId: 'rb-1', version, definition: norm(def),
    definitionSha256: definitionSha256(norm(def)), changelog: null, createdBy: 'user-1', createdAt: new Date(0), ...over,
  };
}

describe('RunbooksService', () => {
  let tx: any;
  let audit: { record: jest.Mock };
  let metrics: { add: jest.Mock };
  let service: RunbooksService;
  let access: { require: jest.Mock; requireIn: jest.Mock; decideManyIn: jest.Mock };
  let principalGroups: { enrich: jest.Mock; groupRoleFor: jest.Mock };
  let grants: { deleteForResources: jest.Mock };

  beforeEach(() => {
    tx = {
      runbook: { delete: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), findFirstOrThrow: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      runbookRun: { count: jest.fn().mockResolvedValue(0) },
      runbookVersion: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      runbookRun: { findMany: jest.fn().mockResolvedValue([]) },
    };
    (global as any).__tx = tx;
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    metrics = { add: jest.fn() };
    access = {
      require: jest.fn().mockResolvedValue(OWNER_DECISION),
      requireIn: jest.fn().mockResolvedValue(OWNER_DECISION),
      decideManyIn: jest.fn().mockImplementation(async (_tx: unknown, _p: unknown, _a: string, refs: Array<{ type: string; id: string }>) =>
        new Map(refs.map((ref) => [`${ref.type}:${ref.id}`, OWNER_DECISION])),
      ),
    };
    principalGroups = { enrich: jest.fn().mockImplementation(async (p: unknown) => p), groupRoleFor: jest.fn() };
    grants = { deleteForResources: jest.fn().mockResolvedValue(0) };
    service = new RunbooksService({} as never, audit as never, access as never, principalGroups as never, grants as never, metrics as never);
  });

  describe('etag helpers', () => {
    it('round-trips and accepts the usual spellings', () => {
      expect(versionEtag(3)).toBe('"v3"');
      expect(parseVersionEtag('"v3"')).toBe(3);
      expect(parseVersionEtag('v3')).toBe(3);
      expect(parseVersionEtag('W/"v12"')).toBe(12);
      expect(parseVersionEtag('3')).toBeNull();
      expect(parseVersionEtag('"x"')).toBeNull();
      expect(parseVersionEtag(undefined)).toBeNull();
    });
  });

  describe('validate', () => {
    it('returns the normalised definition, its hash and warnings', () => {
      const result = service.validate(DEF);
      expect(result.valid).toBe(true);
      expect(result.definitionSha256).toBe(definitionSha256(norm(DEF)));
      expect(result.warnings.map((w) => w.code)).toContain('NO_DEFAULT_TARGETS');
    });

    it('throws 422 RUNBOOK_DEFINITION_INVALID with issue paths and counts it', () => {
      let thrown: any;
      try {
        service.validate({ schemaVersion: 1, steps: [{ id: 'a', name: 'x', kind: 'collect_logs' }] });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(UnprocessableEntityException);
      expect(thrown.getResponse()).toMatchObject({
        code: 'RUNBOOK_DEFINITION_INVALID',
        details: { issues: [{ path: ['steps', 0, 'paths'] }] },
      });
      expect(metrics.add).toHaveBeenCalledWith('runbookDefinitionsSaved', 1, { result: 'invalid' });
    });
  });

  describe('create', () => {
    it('writes the runbook, version 1 and the pointer in one scope, then audits the hash', async () => {
      tx.runbook.create.mockResolvedValue(row({ latestVersionId: null }));
      tx.runbookVersion.create.mockResolvedValue(ver(1, DEF, { changelog: 'first' }));
      tx.runbook.update.mockResolvedValue(row());
      // The response is the caller's own view of what was written.
      tx.runbook.findFirst.mockResolvedValue(row());
      tx.runbookVersion.findFirst.mockResolvedValue(ver(1, DEF, { changelog: 'first' }));

      const result = await service.create(scope, { name: 'Patch', tags: ['a', 'a'], definition: DEF, changelog: 'first' } as never);

      expect(tx.runbook.create.mock.calls[0][0].data).toMatchObject({ orgId: 'org-1', ownerUserId: 'user-1', ownerGroupId: null, name: 'Patch', tags: ['a'] });
      expect(tx.runbookVersion.create.mock.calls[0][0].data).toMatchObject({
        orgId: 'org-1', runbookId: 'rb-1', version: 1, createdBy: 'user-1', changelog: 'first',
        definitionSha256: definitionSha256(norm(DEF)),
      });
      expect(tx.runbook.update).toHaveBeenCalledWith({ where: { id: 'rb-1' }, data: { latestVersionId: 'v-1' } });
      expect(result.latestVersion?.version).toBe(1);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
        action: 'runbook.created', actorUserId: 'user-1', targetType: 'runbook', targetId: 'rb-1',
        meta: { name: 'Patch', version: 1, definition_sha256: definitionSha256(norm(DEF)) },
      }));
      expect(metrics.add).toHaveBeenCalledWith('runbookDefinitionsSaved', 1, { result: 'created' });
    });

    it('answers 409 RUNBOOK_NAME_TAKEN on a live-name index violation and audits nothing', async () => {
      tx.runbook.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
      await expect(service.create(scope, { name: 'Patch', definition: DEF } as never)).rejects.toMatchObject({
        response: { code: 'RUNBOOK_NAME_TAKEN' },
      });
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('rejects an invalid definition before touching the database', async () => {
      await expect(service.create(scope, { name: 'x', definition: { schemaVersion: 1, steps: [] } } as never)).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(tx.runbook.create).not.toHaveBeenCalled();
    });
  });

  describe('replaceDefinition', () => {
    beforeEach(() => {
      tx.runbook.findFirst.mockResolvedValue(row());
      tx.runbookVersion.findFirst.mockResolvedValue(ver(1, DEF));
    });

    it('creates version n+1 and moves the pointer with compare-and-set', async () => {
      tx.runbookVersion.create.mockResolvedValue(ver(2, DEF2));
      tx.runbook.updateMany.mockResolvedValue({ count: 1 });
      tx.runbook.findFirstOrThrow.mockResolvedValue(row({ latestVersionId: 'v-2' }));
      tx.runbook.findFirst.mockResolvedValue(row());

      const out = await service.replaceDefinition(scope, 'rb-1', 1, { definition: DEF2, changelog: 'inodes' } as never);

      expect(out.created).toBe(true);
      expect(out.runbook.latestVersion?.version).toBe(2);
      expect(tx.runbookVersion.create.mock.calls[0][0].data).toMatchObject({ version: 2, changelog: 'inodes' });
      expect(tx.runbook.updateMany).toHaveBeenCalledWith({ where: { id: 'rb-1', orgId: 'org-1', latestVersionId: 'v-1' }, data: { latestVersionId: 'v-2' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'runbook.version_created', meta: { version: 2, definition_sha256: definitionSha256(norm(DEF2)) } }));
    });

    it('creates no version for an identical definition (any key order)', async () => {
      const reordered = { steps: [{ command: 'df -h', kind: 'command', name: 'Disk', id: 'c1' }], schemaVersion: 1 };
      const out = await service.replaceDefinition(scope, 'rb-1', 1, { definition: reordered } as never);
      expect(out.created).toBe(false);
      expect(tx.runbookVersion.create).not.toHaveBeenCalled();
      expect(tx.runbook.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(metrics.add).toHaveBeenCalledWith('runbookDefinitionsSaved', 1, { result: 'unchanged' });
    });

    it('answers 412 for a stale If-Match, even when the definition is unchanged', async () => {
      await expect(service.replaceDefinition(scope, 'rb-1', 0, { definition: DEF2 } as never)).rejects.toMatchObject({ status: 412 });
      await expect(service.replaceDefinition(scope, 'rb-1', 0, { definition: DEF } as never)).rejects.toMatchObject({ status: 412 });
      expect(tx.runbookVersion.create).not.toHaveBeenCalled();
    });

    it('answers 412 when a concurrent writer wins the version key or the pointer', async () => {
      tx.runbookVersion.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
      await expect(service.replaceDefinition(scope, 'rb-1', 1, { definition: DEF2 } as never)).rejects.toMatchObject({ status: 412 });

      tx.runbookVersion.create.mockResolvedValue(ver(2, DEF2));
      tx.runbook.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.replaceDefinition(scope, 'rb-1', 1, { definition: DEF2 } as never)).rejects.toMatchObject({ status: 412 });
    });

    it('refuses to change an archived runbook and 404s an unknown one', async () => {
      tx.runbook.findFirst.mockResolvedValue(row({ archivedAt: new Date() }));
      await expect(service.replaceDefinition(scope, 'rb-1', 1, { definition: DEF2 } as never)).rejects.toMatchObject({ response: { code: 'RUNBOOK_ARCHIVED' } });
      tx.runbook.findFirst.mockResolvedValue(null);
      await expect(service.replaceDefinition(scope, 'rb-1', 1, { definition: DEF2 } as never)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('permanent delete', () => {
    it('needs the delete action, removes the grants and the row, and audits it', async () => {
      tx.runbook.findFirst.mockResolvedValue(row());
      await service.remove(scope, 'rb-1');
      expect(access.requireIn).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'delete', { type: 'runbook', id: 'rb-1' });
      expect(grants.deleteForResources).toHaveBeenCalledWith(tx, 'runbook', ['rb-1']);
      expect(tx.runbook.delete).toHaveBeenCalledWith({ where: { id: 'rb-1' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'runbook.deleted', targetId: 'rb-1' }));
    });

    it('is refused with 409 RUNBOOK_HAS_ACTIVE_RUNS while a run is unfinished, deleting nothing', async () => {
      tx.runbook.findFirst.mockResolvedValue(row());
      tx.runbookRun.count.mockResolvedValue(1);
      await expect(service.remove(scope, 'rb-1')).rejects.toMatchObject({ response: { code: 'RUNBOOK_HAS_ACTIVE_RUNS' } });
      expect(grants.deleteForResources).not.toHaveBeenCalled();
      expect(tx.runbook.delete).not.toHaveBeenCalled();
    });

    it('propagates the access denial (404) before touching anything', async () => {
      access.requireIn.mockRejectedValue(new NotFoundException());
      await expect(service.remove(scope, 'rb-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.runbook.delete).not.toHaveBeenCalled();
    });
  });

  describe('archive and restore', () => {
    it('archives once and audits once', async () => {
      tx.runbook.findFirst.mockResolvedValueOnce(row());
      await service.archive(scope, 'rb-1');
      expect(tx.runbook.update.mock.calls[0][0].data.archivedAt).toBeInstanceOf(Date);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'runbook.archived', targetId: 'rb-1' }));

      audit.record.mockClear();
      tx.runbook.update.mockClear();
      tx.runbook.findFirst.mockResolvedValueOnce(row({ archivedAt: new Date() }));
      await service.archive(scope, 'rb-1');
      expect(tx.runbook.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('restores, audits, and maps a name clash to 409', async () => {
      tx.runbook.findFirst.mockResolvedValue(row({ archivedAt: new Date() }));
      tx.runbook.update.mockResolvedValue(row());
      tx.runbook.findFirstOrThrow.mockResolvedValue(row());
      tx.runbookVersion.findFirst.mockResolvedValue(ver(1, DEF));
      const view = await service.restore(scope, 'rb-1');
      expect(view.archivedAt).toBeNull();
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'runbook.restored' }));

      tx.runbook.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
      await expect(service.restore(scope, 'rb-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('reads', () => {
    it('lists with the latest version summary and scopes every query to the organization', async () => {
      tx.runbook.findMany.mockResolvedValue([row(), row({ id: 'rb-2', latestVersionId: null })]);
      tx.runbook.count.mockResolvedValue(2);
      tx.runbookVersion.findMany.mockResolvedValue([ver(1, DEF)]);
      const page = await service.list(scope, { page: 1, pageSize: 20, includeArchived: false, q: 'pat', tag: 'ops' } as never);
      expect(tx.runbook.findMany.mock.calls[0][0].where.AND).toEqual(expect.arrayContaining([
        { ownerUserId: 'user-1' },
        { orgId: 'org-1' },
        { archivedAt: null },
        { tags: { has: 'ops' } },
      ]));
      expect(page.items[0].access).toMatchObject({ role: 'owner', shared: false, can: { run: true, write: true, share: true } });
      expect(page.items[0].owner).toEqual({ kind: 'user', id: 'user-1', name: 'Person A' });
      expect(page.items[0].latestVersion?.version).toBe(1);
      expect(page.items[1].latestVersion).toBeNull();
      expect(page.items[0].latestVersion).not.toHaveProperty('definition');
      // #65: the step kinds of the latest version (never a command) and no run yet.
      expect(page.items[0].stepKinds).toEqual(['command']);
      expect(page.items[0]).not.toHaveProperty('steps');
      expect(page.items[1].stepKinds).toEqual([]);
      expect(page.items[0].lastRun).toBeNull();
    });

    it('carries the newest run of each listed runbook, from one org-scoped query (#65)', async () => {
      tx.runbook.findMany.mockResolvedValue([row(), row({ id: 'rb-2', latestVersionId: null })]);
      tx.runbook.count.mockResolvedValue(2);
      tx.runbookVersion.findMany.mockResolvedValue([ver(1, DEF)]);
      const run = { id: 'run-1', runbookId: 'rb-1', status: 'failed', createdAt: new Date(1000), finishedAt: new Date(2000) };
      tx.runbookRun.findMany.mockResolvedValue([run]);
      const page = await service.list(scope, { page: 1, pageSize: 20, includeArchived: false } as never);
      expect(tx.runbookRun.findMany).toHaveBeenCalledTimes(1);
      expect(tx.runbookRun.findMany.mock.calls[0][0]).toMatchObject({
        where: { orgId: 'org-1', runbookId: { in: ['rb-1', 'rb-2'] } },
        distinct: ['runbookId'],
      });
      expect(page.items[0].lastRun).toEqual({ id: 'run-1', status: 'failed', createdAt: new Date(1000), finishedAt: new Date(2000) });
      expect(page.items[1].lastRun).toBeNull();
    });

    it('asks AccessPolicy before every read and write, and stops at its refusal', async () => {
      access.requireIn.mockRejectedValue(new NotFoundException('Runbook not found'));
      await expect(service.findOne(scope, 'rb-1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getVersion(scope, 'rb-1', 1)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.replaceDefinition(scope, 'rb-1', 1, { definition: DEF2 } as never)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.archive(scope, 'rb-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(access.requireIn.mock.calls.map((call) => call[2])).toEqual(['read', 'read', 'write', 'write']);
      expect(tx.runbook.findFirst).not.toHaveBeenCalled();
      expect(tx.runbookVersion.create).not.toHaveBeenCalled();
    });

    it('requires `run` on the runbook before a run', async () => {
      await service.requireRun(scope, 'rb-1');
      expect(access.require).toHaveBeenCalledWith(scope, 'run', { type: 'runbook', id: 'rb-1' });
    });

    it('404s a missing version and returns one with its definition', async () => {
      tx.runbookVersion.findFirst.mockResolvedValue(null);
      await expect(service.getVersion(scope, 'rb-1', 9)).rejects.toBeInstanceOf(NotFoundException);
      tx.runbookVersion.findFirst.mockResolvedValue(ver(2, DEF2));
      expect((await service.getVersion(scope, 'rb-1', 2)).definition.steps[0]).toMatchObject({ command: 'df -i' });
    });
  });
});

describe('RunbooksService group ownership', () => {
  it('lets only an admin or editor of a group make it the owner of a new runbook', async () => {
    const groups = { enrich: jest.fn(), groupRoleFor: jest.fn() };
    const svc = new RunbooksService({} as never, { record: jest.fn() } as never, {} as never, groups as never, {} as never);
    groups.groupRoleFor.mockResolvedValueOnce(null);
    await expect(svc.create(scope, { name: 'x', definition: DEF, ownerGroupId: 'g-1' } as never)).rejects.toBeInstanceOf(NotFoundException);
    groups.groupRoleFor.mockResolvedValueOnce('viewer');
    await expect(svc.create(scope, { name: 'x', definition: DEF, ownerGroupId: 'g-1' } as never)).rejects.toMatchObject({
      response: { code: 'GROUP_ROLE_INSUFFICIENT' },
    });
  });
});
