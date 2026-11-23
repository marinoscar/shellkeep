// =============================================================================
// `terminal.ssh.client` (issue #46)
// =============================================================================
//
// The `ssh2` module loads and reports its version and the host-key algorithms it
// supports. Touches no network, no database and no profile: it proves the SSH
// client library the terminal depends on is installed and intact.
// =============================================================================

import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  DoctorCheckRegistry,
  type DoctorCheck,
  type DoctorCheckOutcome,
} from '@marinoscar/platform-api/doctor';

export const SSH_CLIENT_CHECK_ID = 'terminal.ssh.client';

/** What the check reads from the library, injectable so the failure paths are testable. */
export interface SshClientFacts {
  version: string;
  hostKeyAlgorithms: readonly string[];
}

/** Loads `ssh2` and reads its version and supported host-key algorithms. Throws when it cannot. */
export function loadSshClientFacts(): SshClientFacts {
  // `require` on purpose: the check must see a missing or broken install as a
  // finding, not as a failed import of this module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ssh2 = require('ssh2') as { Client?: unknown };
  if (typeof ssh2.Client !== 'function') {
    throw new Error('the ssh2 module loaded but exports no Client');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { version } = require('ssh2/package.json') as { version: string };

  let hostKeyAlgorithms: readonly string[] = [];
  try {
    // ssh2 publishes no list of its algorithms; its constants file is the source of truth.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const constants = require('ssh2/lib/protocol/constants') as { SUPPORTED_SERVER_HOST_KEY?: string[] };
    hostKeyAlgorithms = constants.SUPPORTED_SERVER_HOST_KEY ?? [];
  } catch {
    // The version is the contract; the list is a courtesy.
  }
  return { version, hostKeyAlgorithms };
}

@Injectable()
export class SshClientDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = SSH_CLIENT_CHECK_ID;
  readonly category = 'terminal';
  readonly label = 'SSH client library';
  readonly timeoutMs = 3_000;

  /** Where the facts come from; a test replaces it to exercise the failure path. */
  load: () => SshClientFacts = loadSshClientFacts;

  constructor(private readonly registry: DoctorCheckRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    try {
      const facts = this.load();
      return {
        status: 'pass',
        detail: `ssh2 ${facts.version}; ${facts.hostKeyAlgorithms.length} host-key algorithm(s) supported`,
        data: {
          version: facts.version,
          host_key_algorithms: facts.hostKeyAlgorithms.length,
          algorithms: facts.hostKeyAlgorithms.join(', ') || null,
        },
      };
    } catch (error) {
      return {
        status: 'fail',
        detail: 'The ssh2 library could not be loaded',
        remedy: 'Reinstall the API dependencies (`npm ci`) or rebuild the API image; the terminal cannot connect without ssh2.',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
