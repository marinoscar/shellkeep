// =============================================================================
// `terminal.sessions.reaper` (issue #46)
// =============================================================================
//
// The session reaper marks a connected-but-idle session `detached` after
// `detachAfterMinutes` (default 60). A session still `active` after TWICE that
// threshold means the reaper missed at least one full pass: it is not running,
// or it is failing. A read-only count; never touches a session.
// =============================================================================

import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';
import {
  DoctorCheckRegistry,
  type DoctorCheck,
  type DoctorCheckOutcome,
} from '@marinoscar/platform-api/doctor';

import { PrismaService } from '../../prisma/prisma.service';

export const SESSIONS_REAPER_CHECK_ID = 'terminal.sessions.reaper';

@Injectable()
export class SessionsReaperDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = SESSIONS_REAPER_CHECK_ID;
  readonly category = 'terminal';
  readonly label = 'Session reaper';
  readonly timeoutMs = 5_000;

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
  ) {}

  /** The clock; a test replaces it. */
  now: () => Date = () => new Date();

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    const { detachAfterMinutes } = await this.settings.getNamespace('terminal');
    const cutoff = new Date(this.now().getTime() - 2 * detachAfterMinutes * 60_000);

    const overdue = await this.prisma.terminalSession.count({
      where: { status: 'active', lastActivityAt: { lt: cutoff } },
    });

    if (overdue > 0) {
      return {
        status: 'warn',
        detail: `${overdue} active session(s) have been idle for more than twice the ${detachAfterMinutes}-minute detach threshold`,
        remedy:
          'The session reaper is not running or is failing: open Admin > Jobs and look for failed or stuck `terminal.session.reap` jobs, ' +
          'check the API log for SessionCleanupTask and SessionReapHandler errors, and make sure a job worker is running. ' +
          'Idle sessions keep their SSH connection until it runs.',
        data: { overdue, detach_after_minutes: detachAfterMinutes },
      };
    }
    return {
      status: 'pass',
      detail: 'No active session is overdue for detaching',
      data: { overdue: 0, detach_after_minutes: detachAfterMinutes },
    };
  }
}
