// =============================================================================
// Target resolution (issue #61)
// =============================================================================
//
// `resolve(scope, selector)` turns a selector into the servers a run would work on:
//
//   1. the union of `serverIds` and the servers whose tags match (`any` = overlap,
//      `all` = contains; both given = both must hold) and the members of `groupIds`;
//   2. minus `exclude`;
//   3. partitioned by access: a server the principal may connect to becomes a target,
//      the rest come back as `skipped` (`forbidden`), never silently dropped, so the
//      run matrix and the audit show them. Today the principal may connect to the
//      server profiles they OWN; sharing grants arrive with #71;
//   4. sorted by `name, id` so batching is deterministic;
//   5. capped at `runbooks.maxTargetsPerRun` (the organization's effective value).
//
// `groupIds` answers 422 RUNBOOK_TARGET_GROUPS_UNAVAILABLE until server groups exist (#71).
//
// Server profiles are user-owned, not row-level-secured: every query names the organization.
// =============================================================================

import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { SettingsResolver } from '@marinoscar/platform-api/settings';
import type { Prisma } from '@prisma/client';

import type { OwnerScope } from '../common/types/owner-scope';
import { PrismaService } from '../prisma/prisma.service';
import { readStoredFacts } from '../ssh/server-facts.service';
import { RUNBOOK_ERROR_CODES } from './runbooks.error-codes';
import { targetSelectorSchema, type TargetSelector } from './schema/runbook-definition.schema';
import {
  DEFAULT_RUNBOOKS_SYSTEM_SETTINGS,
  RUNBOOKS_SYSTEM_SETTINGS_KEY,
  type RunbooksSystemSettings,
} from './settings/runbooks.system-settings';

export interface ResolvedTarget {
  id: string;
  name: string;
  hostname: string;
  tags: string[];
  hostKeyTrusted: boolean;
  facts: { prettyName: string | null };
}

export type SkipReason = 'forbidden' | 'not_found';

export interface SkippedTarget {
  serverProfileId: string;
  reason: SkipReason;
}

export interface ResolvedTargets {
  /** The servers a run would work on, sorted by `name, id`, at most `limit`. */
  targets: ResolvedTarget[];
  /** Named or matched servers that will not run, with why. */
  skipped: SkippedTarget[];
  /** The accessible servers found BEFORE the cap. */
  total: number;
  /** Whether `total` exceeded `limit` (the tail was cut). */
  capped: boolean;
  /** The cap that applied. */
  limit: number;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

@Injectable()
export class TargetResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolver,
  ) {}

  /** The cap for an organization: `runbooks.maxTargetsPerRun` with the org layer applied. */
  async maxTargetsPerRun(orgId: string): Promise<number> {
    try {
      const effective = await this.settings.resolveSystem<RunbooksSystemSettings>(RUNBOOKS_SYSTEM_SETTINGS_KEY, { orgId });
      return effective.maxTargetsPerRun;
    } catch {
      return DEFAULT_RUNBOOKS_SYSTEM_SETTINGS.maxTargetsPerRun;
    }
  }

  async resolve(scope: OwnerScope, input: Partial<TargetSelector> | TargetSelector, options: { limit?: number } = {}): Promise<ResolvedTargets> {
    const selector = targetSelectorSchema.parse(input);

    if (selector.groupIds.length > 0) {
      throw new UnprocessableEntityException({
        code: RUNBOOK_ERROR_CODES.TARGET_GROUPS_UNAVAILABLE,
        message: 'Server groups are not available yet; select servers by id or tag.',
        details: { groupIds: selector.groupIds },
      });
    }

    const limit = options.limit ?? (await this.maxTargetsPerRun(scope.orgId));
    const excluded = new Set(selector.exclude);

    const tagClause = this.tagClause(selector);
    const or: Prisma.ServerProfileWhereInput[] = [];
    if (selector.serverIds.length > 0) or.push({ id: { in: selector.serverIds } });
    if (tagClause) or.push(tagClause);
    if (or.length === 0) return { targets: [], skipped: [], total: 0, capped: false, limit };

    const rows = await this.prisma.serverProfile.findMany({
      where: { orgId: scope.orgId, OR: or, ...(excluded.size > 0 ? { id: { notIn: [...excluded] } } : {}) },
      select: { id: true, userId: true, name: true, hostname: true, tags: true, fingerprint: true, facts: true },
    });

    const skipped: SkippedTarget[] = [];
    const accessible: ResolvedTarget[] = [];
    for (const row of rows) {
      if (row.userId !== scope.userId) {
        skipped.push({ serverProfileId: row.id, reason: 'forbidden' });
        continue;
      }
      accessible.push({
        id: row.id,
        name: row.name,
        hostname: row.hostname,
        tags: row.tags,
        hostKeyTrusted: row.fingerprint !== null,
        facts: { prettyName: readStoredFacts(row.facts)?.prettyName ?? null },
      });
    }

    // A server named by id that does not exist in this organization.
    const found = new Set(rows.map((r) => r.id));
    for (const id of selector.serverIds) {
      if (!found.has(id) && !excluded.has(id)) skipped.push({ serverProfileId: id, reason: 'not_found' });
    }

    accessible.sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id));
    skipped.sort((a, b) => compare(a.serverProfileId, b.serverProfileId));

    return {
      targets: accessible.slice(0, limit),
      skipped,
      total: accessible.length,
      capped: accessible.length > limit,
      limit,
    };
  }

  private tagClause(selector: TargetSelector): Prisma.ServerProfileWhereInput | null {
    const { any, all } = selector.tags;
    const parts: Prisma.ServerProfileWhereInput[] = [];
    if (any.length > 0) parts.push({ tags: { hasSome: any } });
    if (all.length > 0) parts.push({ tags: { hasEvery: all } });
    if (parts.length === 0) return null;
    return parts.length === 1 ? parts[0] : { AND: parts };
  }
}
