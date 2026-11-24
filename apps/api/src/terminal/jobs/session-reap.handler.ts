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
// them with the sessions it terminated.
//
// NOTIFICATION (#51). Once `reap()` has returned, its statements have committed (each is
// its own autocommitted statement, never inside a `$transaction`), and only then does
// `process()` send ONE `terminal.session_reaped` notification per owner, listing that
// owner's sessions. `notify` is detached and never rejects, so a mail outage cannot fail
// or retry the job. The payload names a session, its server PROFILE and its idle time:
// never a host, a user, a command or any output.
//
// WEBHOOK (#54). In the same place, after the commit, one `terminal.session.terminated`
// (reason `reaped`) per session step 2 terminated, to the owner's own webhook endpoints.
// `TerminalWebhooksService` never throws, so an outage of the webhooks slice cannot fail
// or retry the job.
// =============================================================================

import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { JobHandlerRegistry, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import { NotificationsService } from '@marinoscar/platform-api/notifications';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { MAX_LISTED_SESSIONS } from '../../email-templates/idle-duration';
import type { TerminalSessionReapedData } from '../../email-templates/terminal-session-reaped.email';
import { TERMINAL_SESSION_REAPED_EVENT } from '../../notifications-registry/terminal.notifications';
import { PrismaService } from '../../prisma/prisma.service';
import { TerminalMetricsService } from '../telemetry/terminal-metrics.service';
import { TerminalWebhooksService } from '../webhooks/terminal-webhooks.service';

/** The job type string. Permanent: rows of this type outlive any rename. */
export const TERMINAL_SESSION_REAP_TYPE = 'terminal.session.reap';

/** A session the reaper terminated (what the `terminal.session_reaped` notification needs). */
export interface ReapedSession {
  id: string;
  userId: string;
  orgId: string;
  name: string;
  serverProfileId: string;
  /** When the session was last active: the idle time is measured from it. */
  lastActivityAt: Date;
}

/**
 * Groups terminated sessions by owner into one notification payload each: the sessions
 * longest-idle first, at most {@link MAX_LISTED_SESSIONS} listed and the rest counted.
 * Pure: `profileNames` maps a server profile id to its NAME (an unknown id reads as "a server").
 */
export function buildReapedNotifications(
  sessions: readonly ReapedSession[],
  profileNames: ReadonlyMap<string, string>,
  now: Date,
): Map<string, TerminalSessionReapedData> {
  const byOwner = new Map<string, ReapedSession[]>();
  for (const session of sessions) {
    const list = byOwner.get(session.userId) ?? [];
    list.push(session);
    byOwner.set(session.userId, list);
  }
  const out = new Map<string, TerminalSessionReapedData>();
  for (const [userId, owned] of byOwner) {
    const lines = owned
      .map((session) => ({
        name: session.name,
        serverName: profileNames.get(session.serverProfileId) ?? 'a server',
        idleMinutes: Math.max(0, Math.floor((now.getTime() - session.lastActivityAt.getTime()) / MINUTE_MS)),
      }))
      .sort((a, b) => b.idleMinutes - a.idleMinutes);
    out.set(userId, {
      sessions: lines.slice(0, MAX_LISTED_SESSIONS),
      moreCount: Math.max(0, lines.length - MAX_LISTED_SESSIONS),
    });
  }
  return out;
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
    private readonly notifications: NotificationsService,
    private readonly webhooks: TerminalWebhooksService,
    @Optional() private readonly metrics?: TerminalMetricsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(_job: Job): Promise<void> {
    const now = new Date();
    const result = await this.reap(now);
    // Counts only, three bounded actions (`app.terminal.sessions.reaped`); never an id.
    this.metrics?.reaped('detached', result.detached);
    this.metrics?.reaped('terminated', result.terminated);
    this.metrics?.reaped('purged', result.purged);
    this.logger.log(
      `Reaped sessions: ${result.detached} detached, ${result.terminated} terminated, ${result.purged} purged`,
    );
    // AFTER the updates committed (reap() has returned), outside any transaction.
    await this.raiseWebhooks(result.terminatedSessions, now);
    await this.notifyOwners(result.terminatedSessions, now);
  }

  /** One `terminal.session.terminated` (reason `reaped`) per session the pass terminated (#54). Never throws. */
  async raiseWebhooks(sessions: readonly ReapedSession[], now: Date): Promise<void> {
    for (const session of sessions) {
      await this.webhooks.sessionTerminated(session, session, 'reaped', now);
    }
  }

  /** One `terminal.session_reaped` per owner. Never throws: a notification must not fail the job. */
  async notifyOwners(sessions: readonly ReapedSession[], now: Date): Promise<void> {
    if (sessions.length === 0) return;
    try {
      const profiles = await this.prisma.serverProfile.findMany({
        where: { id: { in: [...new Set(sessions.map((session) => session.serverProfileId))] } },
        select: { id: true, name: true },
      });
      const names = new Map(profiles.map((profile) => [profile.id, profile.name]));
      for (const [userId, data] of buildReapedNotifications(sessions, names, now)) {
        await this.notifications.notify(TERMINAL_SESSION_REAPED_EVENT, userId, data);
      }
    } catch (error) {
      this.logger.warn(`Could not notify owners of reaped sessions: ${error instanceof Error ? error.name : 'error'}`);
    }
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
      select: { id: true, userId: true, orgId: true, name: true, serverProfileId: true, lastActivityAt: true },
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
