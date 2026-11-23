// =============================================================================
// `terminal.ssh.egress` (issue #46)
// =============================================================================
//
// The terminal's one outbound dependency is SSH to the user's servers. This
// contributor declares it so the platform's `network.egress` check grades it when
// `DEPLOYMENT_NETWORK` is `air-gapped`: a profile that points at a public host
// cannot be reached offline.
//
// HOSTNAMES ONLY. The distinct hostnames of the server profiles, capped at 20
// (`egressDependency` normalises each to a bare lower-case hostname and drops any
// scheme, port, path or userinfo); never a username, a port with credentials or a
// secret. Read-only: one `SELECT DISTINCT`.
//
// Not `required`: the API runs without any SSH target, and a private host is
// reachable offline.
// =============================================================================

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  EGRESS_MAX_HOSTS,
  EgressRegistry,
  egressDependency,
  type EgressContributor,
  type EgressDependency,
} from '@marinoscar/platform-api/doctor';

import { PrismaService } from '../../prisma/prisma.service';

export const SSH_EGRESS_ID = 'terminal.ssh';

@Injectable()
export class TerminalSshEgressContributor implements EgressContributor, OnModuleInit {
  readonly id = 'terminal';
  private readonly logger = new Logger(TerminalSshEgressContributor.name);

  constructor(
    private readonly egress: EgressRegistry,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.egress.register(this);
  }

  async describe(): Promise<EgressDependency[]> {
    let hostnames: string[] = [];
    try {
      const rows = await this.prisma.serverProfile.findMany({
        distinct: ['hostname'],
        select: { hostname: true },
        orderBy: { hostname: 'asc' },
        take: EGRESS_MAX_HOSTS,
      });
      hostnames = rows.map((row) => row.hostname);
    } catch (error) {
      // An unreadable table must not hide the dependency: the contributor still
      // declares SSH, with no host, which an air-gapped grading treats as unknown.
      this.logger.warn(`Could not list server profile hostnames: ${error instanceof Error ? error.message : String(error)}`);
    }

    return [
      egressDependency({
        id: SSH_EGRESS_ID,
        capability: 'Terminal SSH connections',
        direction: 'server',
        enabled: hostnames.length > 0,
        required: false,
        hosts: hostnames,
        count: hostnames.length,
        degradation: 'Terminal sessions and the connection test cannot reach a server that is not on the private network',
        settingsPath: '/servers',
      }),
    ];
  }
}
