// =============================================================================
// `terminal.session.reap` (issue #49)
// =============================================================================
//
// The session reaper, as a queue job. `tasks/session-cleanup.task.ts` is an
// enqueue-only `@Cron`; this handler does the work, in the order the inline task
// always did, against the `terminal` system settings read at run time:
//
//   1. `active`   idle for `detachAfterMinutes`            -> `detached`
//   2. `detached` idle for `terminateDetachedAfterHours`   -> `terminated`
//   3. `terminated` for `purgeTerminatedAfterDays`         -> row deleted
//
// Each statement is a bounded, idempotent UPDATE or DELETE keyed on a status and a
// cutoff, so the queue's at-least-once delivery (a retry, a re-claim after a lost
// lease) is safe: a second run finds nothing left to do.
//
// SERVER-ONLY, by carrying NEITHER `nodeResultSchema` NOR `persistNodeResult`: the
// handler writes as it goes against ShellKeep's own tables, and a worker node must
// never hold database access (nor an SSH credential) for this. It does not touch
// the remote tmux sessions either; killing those stays a product decision for a
// follow-up issue, so a reaped session only changes state in the database.
//
// Each pass also adds its three counts to `app.terminal.sessions.reaped` (attribute `action`).
//
// The job has no result column to write the counts to, so the handler logs them
// (counts only: no session id, name or user reaches a log) and `reap()` returns
// them with the ids of the sessions it terminated, for the `terminal.session_reaped`
// notification (#51), which is sent after the update commits.
// =============================================================================

import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { PrismaService } from '../../prisma/prisma.service';
import { TerminalMetricsService } from '../telemetry/terminal-metrics.service';

/** The job type string. Permanent: rows of this type outlive any rename. */
export const TERMINAL_SESSION_REAP_TYPE = 'terminal.session.reap';

/** A session the reaper terminated (the identifiers #51's notification needs). */
export interface ReapedSession {
  id: string;
  userId: string;
  orgId: string;
}

/** What one pass did. */
export interface SessionReapResult {
  /** `active` sessions marked `detached`. */
  detached: number;
  /** `detached` sessions marked `terminated`. */
  terminated: number;
  /** `terminated` session rows deleted. */
  purged: number;
  /** The sessions step 2 terminated. */
  terminatedSessions: ReapedSession[];
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

@Injectable()
export class SessionReapHandler implements JobHandler, OnModuleInit {
  readonly type = TERMINAL_SESSION_REAP_TYPE;
  readonly label = 'Reap idle terminal sessions';
  readonly profile = { maxRuntimeMs: 120_000, maxAttempts: 3 } as const;

  private readonly logger = new Logger(SessionReapHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
    @Optional() private readonly metrics?: TerminalMetricsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(_job: Job): Promise<void> {
    const result = await this.reap();
    // Counts only, three bounded actions (`app.terminal.sessions.reaped`); never an id.
    this.metrics?.reaped('detached', result.detached);
    this.metrics?.reaped('terminated', result.terminated);
    this.metrics?.reaped('purged', result.purged);
    this.logger.log(
      `Reaped sessions: ${result.detached} detached, ${result.terminated} terminated, ${result.purged} purged`,
    );
  }

  /** One pass, the three statements in order. `now` is injectable for tests. */
  async reap(now: Date = new Date()): Promise<SessionReapResult> {
    const { detachAfterMinutes, terminateDetachedAfterHours, purgeTerminatedAfterDays } =
      await this.settings.getNamespace('terminal');

    const detached = await this.prisma.terminalSession.updateMany({
      where: {
        status: 'active',
        lastActivityAt: { lt: new Date(now.getTime() - detachAfterMinutes * MINUTE_MS) },
      },
      data: { status: 'detached' },
    });

    const terminatedSessions = await this.prisma.terminalSession.updateManyAndReturn({
      where: {
        status: 'detached',
        lastActivityAt: { lt: new Date(now.getTime() - terminateDetachedAfterHours * HOUR_MS) },
      },
      data: { status: 'terminated', terminatedAt: now },
      select: { id: true, userId: true, orgId: true },
    });

    const purged = await this.prisma.terminalSession.deleteMany({
      where: {
        status: 'terminated',
        terminatedAt: { lt: new Date(now.getTime() - purgeTerminatedAfterDays * DAY_MS) },
      },
    });

    return {
      detached: detached.count,
      terminated: terminatedSessions.length,
      purged: purged.count,
      terminatedSessions,
    };
  }
}
