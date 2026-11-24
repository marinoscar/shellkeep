// =============================================================================
// Target resolution (issue #61)
// =============================================================================
//
// `resolve(scope, selector)` turns a selector into the servers a run would work on:
//
//   1. the union of `serverIds` and the servers whose tags match (`any` = overlap,
//      `all` = contains; both given = both must hold) and the members of `groupIds`;
//   2. minus `exclude`;
//   3. partitioned by access (`AccessPolicy`, action `connect`): a server the principal may connect
//      to (their own, one owned by a group of theirs, one shared with them as `operator` or better)
//      becomes a target; the rest come back as `skipped` (`forbidden`), never silently dropped, so
//      the run matrix and the audit show them. A server NAMED by id the caller cannot connect to is
//      `forbidden`; a server matched only by TAG is considered only when the caller may read it, so a
//      tag never reveals another user's private server (#71);
//   4. sorted by `name, id` so batching is deterministic;
//   5. capped at `runbooks.maxTargetsPerRun` (the organization's effective value).
//
// `groupIds` (groups OF SERVERS, a different thing from the sharing slice's user groups) still answers
// 422 RUNBOOK_TARGET_GROUPS_UNAVAILABLE: no such concept exists yet.
//
// Server profiles are user-owned, not row-level-secured: every query names the organization.
// =============================================================================

import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Principal } from '@marinoscar/platform-api/core';
import { SettingsResolver } from '@marinoscar/platform-api/settings';
import { AccessPolicy, PrincipalGroupsProvider } from '@marinoscar/platform-api/sharing';
import type { Prisma } from '@prisma/client';

import { SERVER_PROFILE_RESOURCE } from '../app-registrations/sharing';
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
    private readonly access: AccessPolicy,
    private readonly principalGroups: PrincipalGroupsProvider,
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

  async resolve(principal: Principal, input: Partial<TargetSelector> | TargetSelector, options: { limit?: number } = {}): Promise<ResolvedTargets> {
    const selector = targetSelectorSchema.parse(input);

    if (selector.groupIds.length > 0) {
      throw new UnprocessableEntityException({
        code: RUNBOOK_ERROR_CODES.TARGET_GROUPS_UNAVAILABLE,
        message: 'Server groups are not available yet; select servers by id or tag.',
        details: { groupIds: selector.groupIds },
      });
    }

    const orgId = principal.activeOrgId;
    if (!orgId) throw new ForbiddenException('No active organization');
    const limit = options.limit ?? (await this.maxTargetsPerRun(orgId));
    const excluded = new Set(selector.exclude);

    const tagClause = this.tagClause(selector);
    const or: Prisma.ServerProfileWhereInput[] = [];
    if (selector.serverIds.length > 0) or.push({ id: { in: selector.serverIds } });
    if (tagClause) or.push(tagClause);
    if (or.length === 0) return { targets: [], skipped: [], total: 0, capped: false, limit };

    const rows = await this.prisma.serverProfile.findMany({
      where: { orgId, OR: or, ...(excluded.size > 0 ? { id: { notIn: [...excluded] } } : {}) },
      select: { id: true, name: true, hostname: true, tags: true, fingerprint: true, facts: true },
    });

    // ONE decision per action for the whole batch (`connect`, and `read` for the tag matches).
    const refs = rows.map((row) => ({ type: SERVER_PROFILE_RESOURCE, id: row.id }));
    // The caller's groups are read fresh: the principal the guard built may be a few seconds old.
    const me = await this.principalGroups.enrich(principal);
    const [connect, read] = await Promise.all([
      this.access.decideMany(me, 'connect', refs),
      this.access.decideMany(me, 'read', refs),
    ]);
    const named = new Set(selector.serverIds);

    const skipped: SkippedTarget[] = [];
    const accessible: ResolvedTarget[] = [];
    const considered: typeof rows = [];
    for (const row of rows) {
      const key = `${SERVER_PROFILE_RESOURCE}:${row.id}`;
      // Matched only by tag and not even readable: not the caller's to know about.
      if (!named.has(row.id) && !read.get(key)?.allowed) continue;
      considered.push(row);
      if (!connect.get(key)?.allowed) {
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
    const found = new Set(considered.map((r) => r.id));
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
