// =============================================================================
// The `terminal` section of `GET /api/admin/about` (issue #46)
// =============================================================================
//
// `registerAboutContributor` is import-time and static (the registry freezes when
// the application boots), but the facts need the database and the settings. So
// the contributor registered at import time delegates to a holder, and a Nest
// provider (`TerminalAboutSource`) fills it in `onModuleInit`.
//
// Facts: the active and detached session counts, the `ssh2` version and the
// session reaper's thresholds (the terminal system settings, #48). Scalars only:
// no hostname, user, profile or secret.
// =============================================================================

import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { registerAboutContributor, type AboutContributorDef } from '@marinoscar/platform-api/host';
import { SystemSettingsService } from '@marinoscar/platform-api/settings';

import { PrismaService } from '../../prisma/prisma.service';
import { loadSshClientFacts } from '../doctor/ssh-client.doctor-check';

type Facts = Awaited<ReturnType<AboutContributorDef['describe']>>;

let source: (() => Promise<Facts>) | null = null;

/** The contributor, registered once per process by `app-registrations/host.ts`. */
export const terminalAboutContributor: AboutContributorDef = {
  id: 'terminal',
  label: 'Terminal',
  describe: async (): Promise<Facts> => (source ? source() : { ssh2Version: sshVersion() }),
};

let registered = false;

/** Registers the contributor (idempotent). */
export function registerTerminalAboutContributor(): void {
  if (registered) return;
  registered = true;
  registerAboutContributor(terminalAboutContributor);
}

function sshVersion(): string {
  try {
    return loadSshClientFacts().version;
  } catch {
    return 'unavailable';
  }
}

@Injectable()
export class TerminalAboutSource implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
  ) {}

  private readonly provide = (): Promise<Facts> => this.describe();

  onModuleInit(): void {
    source = this.provide;
  }

  onModuleDestroy(): void {
    if (source === this.provide) source = null;
  }

  async describe(): Promise<Facts> {
    const [groups, terminal] = await Promise.all([
      this.prisma.terminalSession.groupBy({
        by: ['status'],
        where: { status: { in: ['active', 'detached'] } },
        _count: { _all: true },
      }),
      this.settings.getNamespace('terminal'),
    ]);
    const count = (status: string) => groups.find((group) => group.status === status)?._count._all ?? 0;

    return {
      activeSessions: count('active'),
      detachedSessions: count('detached'),
      ssh2Version: sshVersion(),
      detachAfterMinutes: terminal.detachAfterMinutes,
      terminateDetachedAfterHours: terminal.terminateDetachedAfterHours,
      purgeTerminatedAfterDays: terminal.purgeTerminatedAfterDays,
    };
  }
}
