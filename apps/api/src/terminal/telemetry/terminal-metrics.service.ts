// =============================================================================
// Terminal metrics: recorders and the three observable gauges (issue #53)
// =============================================================================
//
// One place the terminal's `app.terminal.*` instruments are fed (names and
// attributes: `terminal.metrics.ts`).
//
//   counters   `authDenied` and `reaped` add to the registered counters through the
//              host core's `AppMetricsService`. They never throw and are no-ops while
//              no SDK is installed (OTEL_ENABLED unset).
//   gauges     `app.terminal.sessions` (status), `app.terminal.ws.connections` and
//              `app.terminal.ssh.connections`, created by one gauge provider, which the
//              metrics host calls only when gauges are on for this process
//              (OTEL_ENABLED=true). Each callback observes NOTHING while the runtime
//              export gate is closed, so a closed gate costs no query.
//
// The two connection gauges read counts the owners hand in (`bindWsConnections`,
// `bindSshConnections`): the gateway's authenticated sockets and the session
// manager's live SSH connections, both in THIS process. The sessions gauge is one
// grouped count over `terminal_sessions` (active and detached), cached for 60
// seconds with one read in flight; every API replica reports the same database-wide
// value, so take the maximum per timestamp, never the sum.
//
// Never a user, session, profile or org id as a label.
// =============================================================================

import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { AppMetricsService } from '@marinoscar/platform-api/host';
import { MetricsHostService, createRegisteredGauge, type AppGaugeContext } from '@marinoscar/platform-api/otel-core';

import { PrismaService } from '../../prisma/prisma.service';
import {
  TERMINAL_SESSIONS_METRIC,
  TERMINAL_SESSIONS_REAPED_METRIC,
  TERMINAL_SESSION_GAUGE_STATUSES,
  TERMINAL_SSH_CONNECTIONS_METRIC,
  TERMINAL_WS_AUTH_DENIED_METRIC,
  TERMINAL_WS_CONNECTIONS_METRIC,
  type SessionReapAction,
  type WsAuthDeniedReason,
} from './terminal.metrics';

/** How long one grouped session count is reused. */
export const SESSION_GAUGE_CACHE_TTL_MS = 60_000;

type SessionCounts = Readonly<Record<(typeof TERMINAL_SESSION_GAUGE_STATUSES)[number], number>>;

@Injectable()
export class TerminalMetricsService implements OnModuleInit {
  private readonly logger = new Logger(TerminalMetricsService.name);
  private wsConnections: () => number = () => 0;
  private sshConnections: () => number = () => 0;
  private cache: { at: number; counts: SessionCounts } | null = null;
  private inFlight: Promise<SessionCounts | null> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly host?: MetricsHostService,
    @Optional() private readonly metrics?: AppMetricsService,
  ) {}

  onModuleInit(): void {
    this.registerGauges();
  }

  /** The gateway's count of authenticated sockets in this process. */
  bindWsConnections(count: () => number): void {
    this.wsConnections = count;
  }

  /** The session manager's count of live SSH connections in this process. */
  bindSshConnections(count: () => number): void {
    this.sshConnections = count;
  }

  /** A WebSocket authentication was refused or expired. */
  authDenied(reason: WsAuthDeniedReason): void {
    this.metrics?.add(TERMINAL_WS_AUTH_DENIED_METRIC, 1, { reason });
  }

  /** The reaper moved `count` sessions on; a zero count records nothing. */
  reaped(action: SessionReapAction, count: number): void {
    if (count > 0) this.metrics?.add(TERMINAL_SESSIONS_REAPED_METRIC, count, { action });
  }

  /**
   * Creates the three gauges when the metrics host runs gauge providers here. Returns
   * whether it registered (false when no host is provided or gauges are off).
   */
  registerGauges(): boolean {
    if (!this.host) return false;
    return this.host.registerGaugeProvider((context) => this.createGauges(context));
  }

  private createGauges(context: AppGaugeContext): void {
    const { meter, gateOpen } = context;

    createRegisteredGauge(meter, TERMINAL_SESSIONS_METRIC).addCallback(async (result) => {
      if (!gateOpen()) return;
      const counts = await this.sessionCounts(context.now());
      if (!counts) return;
      for (const status of TERMINAL_SESSION_GAUGE_STATUSES) result.observe(counts[status], { status });
    });

    createRegisteredGauge(meter, TERMINAL_WS_CONNECTIONS_METRIC).addCallback((result) => {
      if (gateOpen()) result.observe(this.safeCount(this.wsConnections));
    });

    createRegisteredGauge(meter, TERMINAL_SSH_CONNECTIONS_METRIC).addCallback((result) => {
      if (gateOpen()) result.observe(this.safeCount(this.sshConnections));
    });
  }

  private safeCount(read: () => number): number {
    try {
      const value = read();
      return Number.isFinite(value) && value >= 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  /** The grouped count, from the cache when fresh. `null` when the read failed and nothing is cached. */
  private async sessionCounts(now: number): Promise<SessionCounts | null> {
    if (this.cache && now - this.cache.at < SESSION_GAUGE_CACHE_TTL_MS) return this.cache.counts;
    if (!this.inFlight) {
      this.inFlight = this.readSessionCounts(now).finally(() => {
        this.inFlight = null;
      });
    }
    return (await this.inFlight) ?? this.cache?.counts ?? null;
  }

  private async readSessionCounts(now: number): Promise<SessionCounts | null> {
    try {
      const rows = await this.prisma.terminalSession.groupBy({
        by: ['status'],
        where: { status: { in: [...TERMINAL_SESSION_GAUGE_STATUSES] } },
        _count: { _all: true },
      });
      const counts = { active: 0, detached: 0 };
      for (const row of rows) {
        if (row.status === 'active' || row.status === 'detached') counts[row.status] = row._count._all;
      }
      this.cache = { at: now, counts };
      return counts;
    } catch (error) {
      // A metrics fault must never reach a caller; the next collection tries again.
      this.logger.warn(`terminal session gauge read failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}
