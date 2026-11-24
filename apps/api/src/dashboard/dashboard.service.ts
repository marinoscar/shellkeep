import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { runInOrg, type Principal, type RlsTransactionClient } from '@marinoscar/platform-api/core';
import { PrincipalGroupsProvider } from '@marinoscar/platform-api/sharing';
import { Prisma } from '@prisma/client';

import { SERVER_PROFILE_RESOURCE } from '../app-registrations/sharing';
import { PERMISSIONS } from '../common/constants/roles.constants';
import { accessibleListWhere } from '../platform/sharing/sharing-access';
import { PrismaService } from '../prisma/prisma.service';
import { DASHBOARD_RUNS_SOURCE, type DashboardRunsSource } from './dashboard-runs.source';
import {
  DASHBOARD_FAILED_WINDOW_MS,
  DASHBOARD_RECENT_LIMIT,
  dashboardSummarySchema,
  type DashboardRuns,
  type DashboardServers,
  type DashboardSessions,
  type DashboardSummary,
} from './dashboard.schema';

const tracer = trace.getTracer('shellkeep.dashboard');

/** The org-scoped transaction of `runInOrg`. */
type Tx = RlsTransactionClient<PrismaService>;

/** The session statuses the dashboard counts as "running": attached or detached, never terminated. */
const LIVE_STATUSES = ['active', 'detached'] as const;

/**
 * The Home dashboard summary (issue #78). Authorization is decided HERE, not in the UI:
 *
 * - `servers` counts only the profiles the caller may see (owned, owned by a group of theirs,
 *   shared with them: the sharing slice's `accessibleWhere`), and is `null` without `servers:read`.
 * - `sessions` counts only the caller's own sessions in the request's organization.
 * - `runs` is `null` without `runbooks:read`, and `null` while no runs source is bound (#62).
 *
 * Reachability: ShellKeep stores no connection-test result yet (the test route answers and keeps
 * nothing; #79 adds the stored result), so every visible server is `unknown`. The dashboard never
 * opens SSH itself.
 *
 * Cost: a fixed number of COUNTs plus one `LIMIT 5` read, whatever the fleet size (no N+1). No
 * hostname reaches a log or the span.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly principalGroups: PrincipalGroupsProvider,
    @Optional() @Inject(DASHBOARD_RUNS_SOURCE) private readonly runsSource?: DashboardRunsSource,
  ) {}

  async summary(principal: Principal, now: Date = new Date()): Promise<DashboardSummary> {
    return tracer.startActiveSpan('dashboard.summary', async (span) => {
      try {
        const orgId = principal.activeOrgId;
        if (!orgId) throw new ForbiddenException('No active organization');
        const can = (permission: string) => principal.permissions.includes(permission);
        const me = can(PERMISSIONS.SERVERS_READ) ? await this.principalGroups.enrich(principal) : principal;

        const { servers, sessions } = await runInOrg(this.prisma, { userId: me.userId, orgId }, async (tx) => ({
          servers: can(PERMISSIONS.SERVERS_READ) ? await this.servers(tx, me) : null,
          sessions: await this.sessions(tx, me.userId, orgId),
        }));
        const runs = can(PERMISSIONS.RUNBOOKS_READ) ? await this.runs(principal, now) : null;

        span.setAttributes({
          'dashboard.servers.included': servers !== null,
          'dashboard.runs.included': runs !== null,
        });
        span.setStatus({ code: SpanStatusCode.OK });
        return dashboardSummarySchema.parse({ servers, sessions, runs });
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /** Two COUNTs over the visible profiles. */
  private async servers(tx: Tx, me: Principal): Promise<DashboardServers> {
    const visible = (await accessibleListWhere({
      tx,
      principal: me,
      type: SERVER_PROFILE_RESOURCE,
      table: 'server_profiles',
      ownerUserField: 'userId',
      ownerGroupField: 'ownerGroupId',
      filter: 'all',
    })) as Prisma.ServerProfileWhereInput;
    const total = await tx.serverProfile.count({ where: visible });
    const hostKeyUntrusted = await tx.serverProfile.count({ where: { AND: [visible, { fingerprint: null }] } });
    // No connection-test result is stored yet, so nothing is known to be reachable or not.
    return { total, reachable: 0, unreachable: 0, unknown: total, hostKeyUntrusted };
  }

  /** A grouped COUNT by status plus one `LIMIT 5` read with the server's name joined in. */
  private async sessions(tx: Tx, userId: string, orgId: string): Promise<DashboardSessions> {
    const where: Prisma.TerminalSessionWhereInput = { userId, orgId, status: { in: [...LIVE_STATUSES] } };
    const grouped = await tx.terminalSession.groupBy({ by: ['status'], where, _count: { _all: true } });
    const countOf = (status: string) => grouped.find((g) => g.status === status)?._count._all ?? 0;
    const rows = await tx.terminalSession.findMany({
      where,
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'asc' }],
      take: DASHBOARD_RECENT_LIMIT,
      select: {
        id: true,
        name: true,
        status: true,
        serverProfileId: true,
        lastActivityAt: true,
        createdAt: true,
        serverProfile: { select: { name: true } },
      },
    });
    const attached = countOf('active');
    const detached = countOf('detached');
    return {
      active: attached + detached,
      attached,
      detached,
      recent: rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status as (typeof LIVE_STATUSES)[number],
        serverProfileId: row.serverProfileId,
        serverName: row.serverProfile?.name ?? '',
        lastActivityAt: row.lastActivityAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /** The bound runs source, or `null` until the runbook engine (#62) binds one. */
  private async runs(principal: Principal, now: Date): Promise<DashboardRuns | null> {
    if (!this.runsSource) return null;
    return this.runsSource.summarize(principal, {
      failedSince: new Date(now.getTime() - DASHBOARD_FAILED_WINDOW_MS),
      limit: DASHBOARD_RECENT_LIMIT,
    });
  }
}
