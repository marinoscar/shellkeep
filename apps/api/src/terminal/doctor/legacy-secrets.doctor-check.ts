// =============================================================================
// `terminal.ssh.legacy-secrets` (issue #46)
// =============================================================================
//
// Since #48 a server profile's secrets live in the platform credential store
// (purpose `ssh`). The three legacy ciphertext columns of `server_profiles` are
// never read or written any more, but a profile saved by the old build still has
// its secret ONLY there until `npm run ssh:migrate-secrets` copies it. This check
// counts the profiles that hold a legacy value with no matching `ssh` credential
// row: those cannot connect with the current build.
//
// Read-only. The ciphertext is never selected: the legacy columns are used only
// as a `where` filter. Removed with the columns in #84.
// =============================================================================

import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  DoctorCheckRegistry,
  type DoctorCheck,
  type DoctorCheckOutcome,
} from '@marinoscar/platform-api/doctor';

import { PrismaService } from '../../prisma/prisma.service';
import { SSH_CREDENTIAL_PURPOSE, sshCredentialName, type SshSecretField } from '../../server-profiles/ssh-credentials';

export const LEGACY_SECRETS_CHECK_ID = 'terminal.ssh.legacy-secrets';

/** Per legacy column, how many profiles are examined (the count is "at least" beyond this). */
const SCAN_LIMIT = 2_000;

const LEGACY_COLUMNS: ReadonlyArray<{ column: 'encryptedPassword' | 'encryptedPrivateKey' | 'encryptedPassphrase'; field: SshSecretField }> = [
  { column: 'encryptedPassword', field: 'password' },
  { column: 'encryptedPrivateKey', field: 'private_key' },
  { column: 'encryptedPassphrase', field: 'passphrase' },
];

@Injectable()
export class LegacySecretsDoctorCheck implements DoctorCheck, OnModuleInit {
  readonly id = LEGACY_SECRETS_CHECK_ID;
  readonly category = 'terminal';
  readonly label = 'Legacy SSH secrets';
  readonly timeoutMs = 8_000;

  constructor(
    private readonly registry: DoctorCheckRegistry,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async run(): Promise<DoctorCheckOutcome> {
    // (profileId, field) pairs that still hold a legacy value.
    const legacy: Array<{ profileId: string; userId: string; name: string }> = [];
    for (const { column, field } of LEGACY_COLUMNS) {
      const rows = await this.prisma.serverProfile.findMany({
        where: { [column]: { not: null } },
        select: { id: true, userId: true },
        take: SCAN_LIMIT,
      });
      for (const row of rows) {
        legacy.push({ profileId: row.id, userId: row.userId, name: sshCredentialName(row.id, field) });
      }
    }

    if (legacy.length === 0) {
      return { status: 'pass', detail: 'No server profile holds a legacy secret', data: { profiles: 0 } };
    }

    const stored = await this.prisma.userCredential.findMany({
      where: { purpose: SSH_CREDENTIAL_PURPOSE, name: { in: legacy.map((item) => item.name) } },
      select: { userId: true, name: true },
    });
    const have = new Set(stored.map((row) => `${row.userId}:${row.name}`));

    const unmigrated = new Set(
      legacy.filter((item) => !have.has(`${item.userId}:${item.name}`)).map((item) => item.profileId),
    );

    if (unmigrated.size > 0) {
      return {
        status: 'warn',
        detail: `${unmigrated.size} server profile(s) hold a legacy secret with no credential-store entry and cannot connect`,
        remedy: 'Run `npm run ssh:migrate-secrets` (docs/runbooks/ssh-secret-reencryption.md), then re-run the Doctor.',
        data: { profiles: unmigrated.size },
      };
    }
    return {
      status: 'pass',
      detail: 'Every legacy secret has a credential-store entry',
      data: { profiles: 0 },
    };
  }
}
