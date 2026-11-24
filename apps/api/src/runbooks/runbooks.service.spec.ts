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

const scope = { userId: 'user-1', orgId: 'org-1' };
const DEF = { schemaVersion: 1, steps: [{ id: 'c1', name: 'Disk', kind: 'command', command: 'df -h' }] };
const DEF2 = { schemaVersion: 1, steps: [{ id: 'c1', name: 'Disk', kind: 'command', command: 'df -i' }] };
const norm = (d: unknown) => runbookDefinitionSchema.parse(d);

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'rb-1', orgId: 'org-1', ownerUserId: 'user-1', name: 'Patch', description: null, tags: [],
    latestVersionId: 'v-1', archivedAt: null, createdAt: new Date(0), updatedAt: new Date(0), ...over,
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

  beforeEach(() => {
    tx = {
      runbook: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), findFirstOrThrow: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      runbookVersion: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    };
    (global as any).__tx = tx;
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    metrics = { add: jest.fn() };
    service = new RunbooksService({} as never, audit as never, metrics as never);
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

      const result = await service.create(scope, { name: 'Patch', tags: ['a', 'a'], definition: DEF, changelog: 'first' } as never);

      expect(tx.runbook.create.mock.calls[0][0].data).toMatchObject({ orgId: 'org-1', ownerUserId: 'user-1', name: 'Patch', tags: ['a'] });
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
      expect(tx.runbook.findMany.mock.calls[0][0].where).toMatchObject({ orgId: 'org-1', archivedAt: null, tags: { has: 'ops' } });
      expect(page.items[0].latestVersion?.version).toBe(1);
      expect(page.items[1].latestVersion).toBeNull();
      expect(page.items[0].latestVersion).not.toHaveProperty('definition');
    });

    it('404s a missing version and returns one with its definition', async () => {
      tx.runbookVersion.findFirst.mockResolvedValue(null);
      await expect(service.getVersion(scope, 'rb-1', 9)).rejects.toBeInstanceOf(NotFoundException);
      tx.runbookVersion.findFirst.mockResolvedValue(ver(2, DEF2));
      expect((await service.getVersion(scope, 'rb-1', 2)).definition.steps[0]).toMatchObject({ command: 'df -i' });
    });
  });
});
