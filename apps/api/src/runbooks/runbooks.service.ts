// =============================================================================
// Runbooks: definitions, versions and archiving (issue #61)
// =============================================================================
//
// `runbooks` and `runbook_versions` are ORG tables under forced row-level security: every
// read and write goes through `runInOrg` (one transaction whose first statement sets
// `app.org_id`), never a `forOrg` client inside a `$transaction`.
//
// VERSIONS ARE IMMUTABLE. A definition change inserts the next version row and moves
// `runbooks.latest_version_id`; no code path updates or deletes a `runbook_versions` row
// (`test/runbooks/version-immutability.spec.ts` greps for one). The service allocates the
// version number itself, guarded by the `(runbook_id, version)` unique key and a
// compare-and-set on `latest_version_id`, so two concurrent writers cannot both win.
//
// The partial unique index `runbooks_org_name_live_uniq_idx` (live names, case-insensitive)
// is the only name-uniqueness check: a violation (P2002) maps to 409 RUNBOOK_NAME_TAKEN,
// never a `findFirst` pre-check.
//
// AUDIT: `AUDIT_SINK` after the write commits; the meta is scalars (ids, version numbers,
// the definition hash), never a definition, a command or a secret.
// =============================================================================

import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AUDIT_SINK, runInOrg, type AuditSink, type Principal, type RlsTransactionClient } from '@marinoscar/platform-api/core';
import { AppMetricsService } from '@marinoscar/platform-api/host';
import {
  AccessPolicy,
  PrincipalGroupsProvider,
  type AccessDecision,
} from '@marinoscar/platform-api/sharing';
import { Prisma } from '@prisma/client';

import { RUNBOOK_RESOURCE } from '../app-registrations/sharing';
import { recordAudit } from '../common/audit/record-audit';
import type { OwnerScope } from '../common/types/owner-scope';
import { accessibleListWhere, capabilitiesOf, requireGroupOwnership } from '../platform/sharing/sharing-access';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateRunbookDto,
  ReplaceDefinitionDto,
  RunbooksQueryDto,
  UpdateRunbookMetadataDto,
  VersionsQueryDto,
} from './dto/runbook.dto';
import { RUNBOOK_ERROR_CODES } from './runbooks.error-codes';
import {
  RUNBOOK_DEFINITIONS_SAVED_METRIC,
  type RunbookDefinitionSaveResult,
} from './runbooks.metrics';
import { definitionSha256 } from './schema/definition-hash';
import { definitionWarnings, type DefinitionWarning } from './schema/definition-warnings';
import { runbookDefinitionSchema, type RunbookDefinition } from './schema/runbook-definition.schema';

export interface RunbookVersionSummary {
  id: string;
  version: number;
  definitionSha256: string;
  changelog: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface RunbookVersionView extends RunbookVersionSummary {
  definition: RunbookDefinition;
}

/** Who owns a runbook: the user who authored it, or the group it was created for. */
export interface RunbookOwner {
  kind: 'user' | 'group';
  id: string | null;
  name: string | null;
}

/** What the caller is to a runbook, and what that lets them do. */
export interface RunbookAccess {
  role: string | null;
  via: string | null;
  shared: boolean;
  can: Record<(typeof RUNBOOK_RESPONSE_ACTIONS)[number], boolean>;
}

export interface RunbookView {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  ownerUserId: string | null;
  ownerGroupId: string | null;
  owner: RunbookOwner;
  access: RunbookAccess;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  latestVersion: RunbookVersionSummary | null;
}

export interface RunbookDetail extends Omit<RunbookView, 'latestVersion'> {
  latestVersion: RunbookVersionView | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ValidationResult {
  valid: true;
  definition: RunbookDefinition;
  definitionSha256: string;
  warnings: DefinitionWarning[];
}

/** The actions a response says the caller may take (the UI hides the rest; the API still decides). */
const RUNBOOK_RESPONSE_ACTIONS = ['run', 'write', 'share'] as const;

const OWNER_INCLUDE = {
  owner: { select: { id: true, displayName: true, email: true } },
  ownerGroup: { select: { id: true, name: true } },
} satisfies Prisma.RunbookInclude;

type OrgTx = RlsTransactionClient<PrismaService>;
type RunbookRow = Prisma.RunbookGetPayload<{ include: typeof OWNER_INCLUDE }>;
type VersionRow = Prisma.RunbookVersionGetPayload<object>;

const summaryOf = (v: VersionRow): RunbookVersionSummary => ({
  id: v.id,
  version: v.version,
  definitionSha256: v.definitionSha256,
  changelog: v.changelog,
  createdBy: v.createdBy,
  createdAt: v.createdAt,
});

const ownerOf = (r: RunbookRow): RunbookOwner =>
  r.ownerGroup
    ? { kind: 'group', id: r.ownerGroup.id, name: r.ownerGroup.name }
    : { kind: 'user', id: r.owner?.id ?? null, name: r.owner ? (r.owner.displayName ?? r.owner.email) : null };

const accessOf = (r: RunbookRow, decision: AccessDecision | null, permissions: readonly string[]): RunbookAccess => {
  const role = decision?.role ?? null;
  return {
    role,
    via: decision?.via ?? null,
    shared: !(role === 'owner' && !r.ownerGroupId),
    can: capabilitiesOf(RUNBOOK_RESOURCE, role, RUNBOOK_RESPONSE_ACTIONS, permissions),
  };
};

const viewOf = (
  r: RunbookRow,
  latest: VersionRow | null | undefined,
  decision: AccessDecision | null,
  permissions: readonly string[],
): RunbookView => ({
  id: r.id,
  name: r.name,
  description: r.description,
  tags: r.tags,
  ownerUserId: r.ownerUserId,
  ownerGroupId: r.ownerGroupId,
  owner: ownerOf(r),
  access: accessOf(r, decision, permissions),
  archivedAt: r.archivedAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  latestVersion: latest ? summaryOf(latest) : null,
});

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** `"v3"`, `v3` or `W/"v3"` to 3; `null` when it is none of those. */
export function parseVersionEtag(header: string | undefined): number | null {
  const match = /^\s*(?:W\/)?"?v(\d{1,9})"?\s*$/.exec(header ?? '');
  return match ? Number(match[1]) : null;
}

export const versionEtag = (version: number): string => `"v${version}"`;

@Injectable()
export class RunbooksService {
  private readonly logger = new Logger(RunbooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_SINK) private readonly auditSink: AuditSink,
    private readonly access: AccessPolicy,
    private readonly principalGroups: PrincipalGroupsProvider,
    @Optional() private readonly metrics?: AppMetricsService,
  ) {}

  /** The caller with their groups read fresh: the principal the guard built may be a few seconds old. */
  private actor(principal: Principal): Promise<Principal> {
    return this.principalGroups.enrich(principal);
  }

  private scopeOf(principal: Principal): OwnerScope {
    if (!principal.activeOrgId) throw new ForbiddenException('No active organization');
    return { userId: principal.userId, orgId: principal.activeOrgId };
  }

  // ---------------------------------------------------------------------------
  // Definition validation
  // ---------------------------------------------------------------------------

  /** Parses a definition into its normalised form, or throws 422 RUNBOOK_DEFINITION_INVALID with the issue paths. */
  parseDefinition(input: unknown): RunbookDefinition {
    const result = runbookDefinitionSchema.safeParse(input);
    if (!result.success) {
      this.count('invalid');
      throw new UnprocessableEntityException({
        code: RUNBOOK_ERROR_CODES.DEFINITION_INVALID,
        message: 'The runbook definition is not valid',
        details: {
          issues: result.error.issues.map((issue) => ({
            path: issue.path.map((segment) => (typeof segment === 'symbol' ? String(segment) : segment)),
            code: issue.code,
            message: issue.message,
          })),
        },
      });
    }
    return result.data;
  }

  /** Validates without saving: the normalised definition, its hash and non-blocking warnings. */
  validate(input: unknown): ValidationResult {
    const definition = this.parseDefinition(input);
    return { valid: true, definition, definitionSha256: definitionSha256(definition), warnings: definitionWarnings(definition) };
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * The runbooks the caller may see: those they authored, those of a group of theirs and those
   * shared with them or with a group of theirs (`filter`: `all`, `mine`, `shared`).
   */
  async list(principal: Principal, query: RunbooksQueryDto): Promise<Page<RunbookView>> {
    const me = await this.principalGroups.enrich(principal);
    const scope = this.scopeOf(me);
    return runInOrg(this.prisma, scope, async (tx) => {
      const visible = await accessibleListWhere({
        tx,
        principal: me,
        type: RUNBOOK_RESOURCE,
        table: 'runbooks',
        ownerUserField: 'ownerUserId',
        ownerGroupField: 'ownerGroupId',
        filter: query.filter,
      });
      const where: Prisma.RunbookWhereInput = {
        AND: [
          visible as Prisma.RunbookWhereInput,
          { orgId: scope.orgId },
          ...(query.includeArchived ? [] : [{ archivedAt: null }]),
          ...(query.tag ? [{ tags: { has: query.tag } }] : []),
          ...(query.q
            ? [
                {
                  OR: [
                    { name: { contains: query.q, mode: 'insensitive' as const } },
                    { description: { contains: query.q, mode: 'insensitive' as const } },
                  ],
                },
              ]
            : []),
        ],
      };
      const [rows, total] = await Promise.all([
        tx.runbook.findMany({
          where,
          include: OWNER_INCLUDE,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.runbook.count({ where }),
      ]);
      const latestIds = rows.map((r) => r.latestVersionId).filter((id): id is string => id !== null);
      const versions = latestIds.length
        ? await tx.runbookVersion.findMany({ where: { orgId: scope.orgId, id: { in: latestIds } } })
        : [];
      const byId = new Map(versions.map((v) => [v.id, v]));
      const decisions = await this.access.decideManyIn(
        tx,
        me,
        'read',
        rows.map((r) => ({ type: RUNBOOK_RESOURCE, id: r.id })),
      );
      return {
        items: rows.map((r) =>
          viewOf(r, r.latestVersionId ? byId.get(r.latestVersionId) : null, decisions.get(`${RUNBOOK_RESOURCE}:${r.id}`) ?? null, me.permissions),
        ),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async findOne(principal: Principal, id: string): Promise<RunbookDetail> {
    const scope = this.scopeOf(principal);
    const me = await this.actor(principal);
    return runInOrg(this.prisma, scope, async (tx) => {
      const decision = await this.access.requireIn(tx, me, 'read', { type: RUNBOOK_RESOURCE, id });
      const row = await tx.runbook.findFirst({ where: { id, orgId: scope.orgId }, include: OWNER_INCLUDE });
      if (!row) throw new NotFoundException('Runbook not found');
      const latest = row.latestVersionId
        ? await tx.runbookVersion.findFirst({ where: { id: row.latestVersionId, orgId: scope.orgId } })
        : null;
      return this.detailOf(row, latest, decision, principal.permissions);
    });
  }

  async listVersions(principal: Principal, id: string, query: VersionsQueryDto): Promise<Page<RunbookVersionSummary>> {
    const scope = this.scopeOf(principal);
    const me = await this.actor(principal);
    return runInOrg(this.prisma, scope, async (tx) => {
      await this.access.requireIn(tx, me, 'read', { type: RUNBOOK_RESOURCE, id });
      const where = { orgId: scope.orgId, runbookId: id };
      const [rows, total] = await Promise.all([
        tx.runbookVersion.findMany({
          where,
          orderBy: { version: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.runbookVersion.count({ where }),
      ]);
      return { items: rows.map(summaryOf), total, page: query.page, pageSize: query.pageSize };
    });
  }

  async getVersion(principal: Principal, id: string, version: number): Promise<RunbookVersionView> {
    const scope = this.scopeOf(principal);
    const me = await this.actor(principal);
    return runInOrg(this.prisma, scope, async (tx) => {
      await this.access.requireIn(tx, me, 'read', { type: RUNBOOK_RESOURCE, id });
      const row = await tx.runbookVersion.findFirst({ where: { orgId: scope.orgId, runbookId: id, version } });
      if (!row) throw new NotFoundException('Runbook version not found');
      return { ...summaryOf(row), definition: row.definition as unknown as RunbookDefinition };
    });
  }

  /**
   * The decision before a run (the run engine and its enqueue route call it): the caller may `run` the
   * runbook (404 for a runbook they cannot see, 404 for one they may read but not run, 403 naming
   * `runbooks:run` when the permission is missing). Which servers it may run ON is decided per target by
   * the target resolver (`connect`), never here.
   */
  async requireRun(principal: Principal, id: string): Promise<void> {
    await this.access.require(await this.actor(principal), 'run', { type: RUNBOOK_RESOURCE, id });
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  /** Creates a runbook with its first version. `ownerGroupId` makes a group the owner (the author must be its admin or editor). */
  async create(principal: Principal, dto: CreateRunbookDto): Promise<RunbookDetail> {
    const scope = this.scopeOf(principal);
    if (dto.ownerGroupId) await requireGroupOwnership(this.principalGroups, principal, dto.ownerGroupId, 'a runbook');
    const definition = this.parseDefinition(dto.definition);
    const sha = definitionSha256(definition);

    const created = await this.guardName(() =>
      runInOrg(this.prisma, scope, async (tx) => {
        const runbook = await tx.runbook.create({
          data: {
            orgId: scope.orgId,
            ownerUserId: scope.userId,
            ownerGroupId: dto.ownerGroupId ?? null,
            name: dto.name,
            description: dto.description ?? null,
            tags: dedupe(dto.tags ?? []),
          },
        });
        const version = await tx.runbookVersion.create({
          data: this.versionData(scope, runbook.id, 1, definition, sha, dto.changelog),
        });
        await tx.runbook.update({ where: { id: runbook.id }, data: { latestVersionId: version.id } });
        return runbook.id;
      }),
    );

    this.count('created');
    await this.audit('runbook.created', scope, created, {
      name: dto.name,
      version: 1,
      definition_sha256: sha,
      ...(dto.ownerGroupId ? { ownerGroupId: dto.ownerGroupId } : {}),
    });
    return this.findOne(principal, created);
  }

  /**
   * Replaces the definition: a new version, unless the definition hashes the same as the latest
   * one (then nothing is written). `expectedVersion` is the version the client saw (`If-Match`);
   * a different latest version is 412.
   */
  async replaceDefinition(
    principal: Principal,
    id: string,
    expectedVersion: number,
    dto: ReplaceDefinitionDto,
  ): Promise<{ runbook: RunbookDetail; created: boolean }> {
    const scope = this.scopeOf(principal);
    const me = await this.actor(principal);
    const definition = this.parseDefinition(dto.definition);
    const sha = definitionSha256(definition);

    const outcome = await this.guardStale(() =>
      runInOrg(this.prisma, scope, async (tx) => {
        const decision = await this.access.requireIn(tx, me, 'write', { type: RUNBOOK_RESOURCE, id });
        const row = await this.requireRunbook(tx, scope, id);
        if (row.archivedAt) throw this.archived();
        const latest = row.latestVersionId
          ? await tx.runbookVersion.findFirst({ where: { id: row.latestVersionId, orgId: scope.orgId } })
          : null;
        const currentVersion = latest?.version ?? 0;
        if (currentVersion !== expectedVersion) throw this.stale(currentVersion);

        if (latest && latest.definitionSha256 === sha) {
          return { runbook: this.detailOf(row, latest, decision, principal.permissions), created: false, version: latest.version };
        }

        const next = currentVersion + 1;
        const version = await tx.runbookVersion.create({
          data: this.versionData(scope, id, next, definition, sha, dto.changelog),
        });
        // Compare-and-set: only the writer that still sees the version it read may move the pointer.
        const moved = await tx.runbook.updateMany({
          where: { id, orgId: scope.orgId, latestVersionId: row.latestVersionId },
          data: { latestVersionId: version.id },
        });
        if (moved.count !== 1) throw this.stale(next);
        const updated = await tx.runbook.findFirstOrThrow({ where: { id, orgId: scope.orgId }, include: OWNER_INCLUDE });
        return { runbook: this.detailOf(updated, version, decision, principal.permissions), created: true, version: next };
      }),
    );

    if (outcome.created) {
      this.count('version_created');
      await this.audit('runbook.version_created', scope, id, { version: outcome.version, definition_sha256: sha });
    } else {
      this.count('unchanged');
    }
    return { runbook: outcome.runbook, created: outcome.created };
  }

  async updateMetadata(principal: Principal, id: string, dto: UpdateRunbookMetadataDto): Promise<RunbookView> {
    const scope = this.scopeOf(principal);
    const me = await this.actor(principal);
    return this.guardName(() =>
      runInOrg(this.prisma, scope, async (tx) => {
        const decision = await this.access.requireIn(tx, me, 'write', { type: RUNBOOK_RESOURCE, id });
        const row = await this.requireRunbook(tx, scope, id);
        if (row.archivedAt) throw this.archived();
        await tx.runbook.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.description !== undefined ? { description: dto.description } : {}),
            ...(dto.tags !== undefined ? { tags: dedupe(dto.tags) } : {}),
          },
        });
        const updated = await tx.runbook.findFirstOrThrow({ where: { id, orgId: scope.orgId }, include: OWNER_INCLUDE });
        const latest = updated.latestVersionId
          ? await tx.runbookVersion.findFirst({ where: { id: updated.latestVersionId, orgId: scope.orgId } })
          : null;
        return viewOf(updated, latest, decision, principal.permissions);
      }),
    );
  }

  /** Soft delete. Idempotent: archiving an archived runbook changes nothing. A hard delete is the user-data purge (#69). */
  async archive(principal: Principal, id: string): Promise<void> {
    const scope = this.scopeOf(principal);
    const me = await this.actor(principal);
    const changed = await runInOrg(this.prisma, scope, async (tx) => {
      await this.access.requireIn(tx, me, 'write', { type: RUNBOOK_RESOURCE, id });
      const row = await this.requireRunbook(tx, scope, id);
      if (row.archivedAt) return false;
      await tx.runbook.update({ where: { id }, data: { archivedAt: new Date() } });
      return true;
    });
    if (changed) await this.audit('runbook.archived', scope, id, {});
  }

  async restore(principal: Principal, id: string): Promise<RunbookView> {
    const scope = this.scopeOf(principal);
    const me = await this.actor(principal);
    const result = await this.guardName(() =>
      runInOrg(this.prisma, scope, async (tx) => {
        const decision = await this.access.requireIn(tx, me, 'write', { type: RUNBOOK_RESOURCE, id });
        const row = await this.requireRunbook(tx, scope, id);
        const wasArchived = row.archivedAt !== null;
        if (wasArchived) await tx.runbook.update({ where: { id }, data: { archivedAt: null } });
        const updated = wasArchived ? await tx.runbook.findFirstOrThrow({ where: { id, orgId: scope.orgId }, include: OWNER_INCLUDE }) : row;
        const latest = updated.latestVersionId
          ? await tx.runbookVersion.findFirst({ where: { id: updated.latestVersionId, orgId: scope.orgId } })
          : null;
        return { view: viewOf(updated, latest, decision, principal.permissions), wasArchived };
      }),
    );
    if (result.wasArchived) await this.audit('runbook.restored', scope, id, {});
    return result.view;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async requireRunbook(tx: OrgTx, scope: OwnerScope, id: string): Promise<RunbookRow> {
    const row = await tx.runbook.findFirst({ where: { id, orgId: scope.orgId }, include: OWNER_INCLUDE });
    if (!row) throw new NotFoundException('Runbook not found');
    return row;
  }

  private detailOf(
    row: RunbookRow,
    latest: VersionRow | null,
    decision: AccessDecision | null,
    permissions: readonly string[],
  ): RunbookDetail {
    return {
      ...viewOf(row, null, decision, permissions),
      latestVersion: latest ? { ...summaryOf(latest), definition: latest.definition as unknown as RunbookDefinition } : null,
    };
  }

  private versionData(
    scope: OwnerScope,
    runbookId: string,
    version: number,
    definition: RunbookDefinition,
    sha: string,
    changelog: string | undefined,
  ): Prisma.RunbookVersionUncheckedCreateInput {
    return {
      orgId: scope.orgId,
      runbookId,
      version,
      definition: definition as unknown as Prisma.InputJsonValue,
      definitionSha256: sha,
      changelog: changelog ?? null,
      createdBy: scope.userId,
    };
  }

  private archived(): ConflictException {
    return new ConflictException({
      code: RUNBOOK_ERROR_CODES.ARCHIVED,
      message: 'The runbook is archived; restore it before changing it',
    });
  }

  private stale(currentVersion?: number): HttpException {
    return new HttpException(
      {
        code: 'PRECONDITION_FAILED',
        message: 'The runbook changed since you loaded it; reload and apply your change again',
        ...(currentVersion === undefined ? {} : { details: { currentVersion } }),
      },
      412,
    );
  }

  /** A lost race on the version key (or the pointer) is the same 412 as a stale `If-Match`. */
  private async guardStale<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolation(error)) throw this.stale();
      throw error;
    }
  }

  /** A violation of the live-name index is 409 RUNBOOK_NAME_TAKEN. */
  private async guardName<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: RUNBOOK_ERROR_CODES.NAME_TAKEN,
          message: 'Another runbook in this organization already has this name',
        });
      }
      throw error;
    }
  }

  private count(result: RunbookDefinitionSaveResult): void {
    this.metrics?.add(RUNBOOK_DEFINITIONS_SAVED_METRIC, 1, { result });
  }

  private audit(
    action: string,
    scope: OwnerScope,
    runbookId: string,
    meta: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    return recordAudit(this.auditSink, this.logger, {
      action,
      actorUserId: scope.userId,
      targetType: 'runbook',
      targetId: runbookId,
      meta,
    });
  }
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

