// =============================================================================
// Re-encrypt SSH secrets into the platform credential store (issue #48)
// =============================================================================
//
// Before #48 a server profile's secrets were AES-256-GCM ciphertexts in three
// columns of `server_profiles`, encrypted with the legacy key (`legacy-cipher.ts`).
// They now live in the platform's per-user credential store (purpose `ssh`, names
// `profile.<profileId>.password | private_key | passphrase`), encrypted with an
// owner-bound sub-key of the platform secrets key. This command copies them.
//
//   npm run ssh:migrate-secrets                  dry run (the default): counts, no write
//   npm run ssh:migrate-secrets -- --apply       copy every field that has no credential yet
//   npm run ssh:migrate-secrets -- --verify      re-read every pair and compare
//
// Properties (the runbook, docs/runbooks/ssh-secret-reencryption.md, relies on them):
//
//   - NOTHING IS WRITTEN WITHOUT --apply, and --verify never writes.
//   - IDEMPOTENT: a field that already has a credential is never overwritten, so a
//     re-run copies only what is missing.
//   - EVERY COPY IS READ BACK: after `setSecret` the secret is read with `getSecret`
//     and compared with the decrypted legacy value; a mismatch removes the copy and
//     counts as a failure.
//   - UNDECRYPTABLE ROWS ARE REPORTED AND SKIPPED, by profile id and field (never
//     their content), and make the command exit non-zero.
//   - THE LEGACY COLUMNS ARE NEVER CHANGED OR CLEARED: the previous build keeps
//     working with the legacy key until a later migration drops them (#84).
//   - NEVER LOGS A PLAINTEXT OR A CIPHERTEXT: output is counts, profile ids, field
//     names and fixed reason codes. Errors are reported by class, never by message.
//
// This is the only file outside `legacy-cipher.ts` that may read the legacy key.
// =============================================================================

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { assertEncryptionKeyConfigured } from '@marinoscar/platform-api/core';
import { UserCredentialsService } from '@marinoscar/platform-api/credentials';

import { buildDatabaseUrl } from '../../common/database-url';
import { registerShellkeepCredentialPurposes } from '../../app-registrations/credentials';
import { SSH_CREDENTIAL_PURPOSE, type SshSecretField, sshCredentialName } from '../ssh-credentials';
import { decrypt, getEncryptionKey } from './legacy-cipher';

export type MigrationMode = 'dry-run' | 'apply' | 'verify';

/** One legacy column and the credential field it becomes. */
export const LEGACY_FIELDS = [
  { field: 'password', column: 'encryptedPassword' },
  { field: 'private_key', column: 'encryptedPrivateKey' },
  { field: 'passphrase', column: 'encryptedPassphrase' },
] as const satisfies ReadonlyArray<{ field: SshSecretField; column: string }>;

/** Why a legacy value could not be used. Fixed codes: never a message, never content. */
export type UnusableReason = 'bad-format' | 'auth-failed' | 'blank';

export interface FieldReport {
  /** Non-null legacy columns. */
  source: number;
  /** Dry run: would be copied. Apply: copied now. */
  toCopy: number;
  /** A credential already exists at the address (never overwritten). */
  alreadyCopied: number;
  /** Legacy value cannot be decrypted (or is blank): skipped. */
  undecryptable: number;
  /** Apply: the copy could not be stored or did not read back equal. */
  failed: number;
  /** Verify: pairs whose credential decrypts to the legacy value. */
  target: number;
  /** Verify: pairs missing or different. */
  mismatched: number;
}

export interface ProfileIssue {
  profileId: string;
  field: SshSecretField;
  reason: UnusableReason | 'store-error' | 'readback-mismatch' | 'missing' | 'differs';
}

export interface MigrationReport {
  mode: MigrationMode;
  profiles: number;
  fields: Record<SshSecretField, FieldReport>;
  issues: ProfileIssue[];
  /** True when no row needs attention (no undecryptable value, failed copy or mismatch). */
  clean: boolean;
}

/** The slice of the Prisma client the command reads. */
export interface ProfileSource {
  serverProfile: {
    findMany(args: {
      where?: { id: { gt: string } };
      orderBy: { id: 'asc' };
      take: number;
      select: Record<string, true>;
    }): Promise<Array<Record<string, unknown> & { id: string; userId: string }>>;
  };
}

/** The slice of `UserCredentialsService` the command uses. */
export type CredentialStore = Pick<UserCredentialsService, 'describe' | 'getSecret' | 'setSecret' | 'deleteSecret'>;

const BATCH = 200;

function emptyReport(): FieldReport {
  return { source: 0, toCopy: 0, alreadyCopied: 0, undecryptable: 0, failed: 0, target: 0, mismatched: 0 };
}

/** Decrypts one legacy value; returns the plaintext or the fixed reason it is unusable. */
function decryptLegacy(ciphertext: string, key: Buffer): { ok: true; plaintext: string } | { ok: false; reason: UnusableReason } {
  try {
    const plaintext = decrypt(ciphertext, key);
    if (plaintext.length === 0) return { ok: false, reason: 'blank' };
    return { ok: true, plaintext };
  } catch (error) {
    // `decrypt` throws our own format error, or a crypto error (bad key or tampered data).
    // Only the class of failure is kept: neither message may reach a log.
    const isFormat = error instanceof Error && error.message.startsWith('Invalid encrypted format');
    return { ok: false, reason: isFormat ? 'bad-format' : 'auth-failed' };
  }
}

/**
 * Runs the migration in one mode over every server profile, in id order. Pure of
 * process state (no env reads, no console), so a spec drives it with a real or fake
 * database and the real `UserCredentialsService`.
 */
export async function migrateSshSecrets(
  mode: MigrationMode,
  deps: { prisma: ProfileSource; credentials: CredentialStore; legacyKey: Buffer },
): Promise<MigrationReport> {
  const { prisma, credentials, legacyKey } = deps;
  const fields: Record<SshSecretField, FieldReport> = {
    password: emptyReport(),
    private_key: emptyReport(),
    passphrase: emptyReport(),
  };
  const issues: ProfileIssue[] = [];
  let profiles = 0;
  let cursor: string | undefined;

  for (;;) {
    const batch = await prisma.serverProfile.findMany({
      ...(cursor ? { where: { id: { gt: cursor } } } : {}),
      orderBy: { id: 'asc' },
      take: BATCH,
      select: { id: true, userId: true, encryptedPassword: true, encryptedPrivateKey: true, encryptedPassphrase: true },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    for (const profile of batch) {
      profiles += 1;
      for (const { field, column } of LEGACY_FIELDS) {
        const ciphertext = profile[column];
        if (typeof ciphertext !== 'string' || ciphertext.length === 0) continue;

        const report = fields[field];
        report.source += 1;
        const name = sshCredentialName(profile.id, field);
        const legacy = decryptLegacy(ciphertext, legacyKey);

        if (!legacy.ok) {
          report.undecryptable += 1;
          issues.push({ profileId: profile.id, field, reason: legacy.reason });
          continue;
        }

        if (mode === 'verify') {
          const stored = await credentials.getSecret(profile.userId, SSH_CREDENTIAL_PURPOSE, name).catch(() => undefined);
          if (stored === legacy.plaintext) {
            report.target += 1;
          } else {
            report.mismatched += 1;
            issues.push({ profileId: profile.id, field, reason: stored === null ? 'missing' : 'differs' });
          }
          continue;
        }

        const existing = await credentials.describe(profile.userId, SSH_CREDENTIAL_PURPOSE, name);
        if (existing) {
          report.alreadyCopied += 1;
          continue;
        }

        if (mode === 'dry-run') {
          report.toCopy += 1;
          continue;
        }

        try {
          await credentials.setSecret(profile.userId, SSH_CREDENTIAL_PURPOSE, name, legacy.plaintext);
          const readBack = await credentials.getSecret(profile.userId, SSH_CREDENTIAL_PURPOSE, name);
          if (readBack !== legacy.plaintext) {
            await credentials.deleteSecret(profile.userId, SSH_CREDENTIAL_PURPOSE, name);
            report.failed += 1;
            issues.push({ profileId: profile.id, field, reason: 'readback-mismatch' });
            continue;
          }
          report.toCopy += 1;
        } catch {
          // The error class is not even kept: a store error message may name an address.
          report.failed += 1;
          issues.push({ profileId: profile.id, field, reason: 'store-error' });
        }
      }
    }
  }

  // Clean: no row needs attention. A dry run with fields still to copy is clean (that is
  // what a dry run is for); an undecryptable row, a failed copy or a mismatch never is.
  const clean = issues.length === 0;
  return { mode, profiles, fields, issues, clean };
}

/** The report as text: counts, ids and reason codes only. */
export function formatReport(report: MigrationReport): string[] {
  const lines: string[] = [];
  const label = { 'dry-run': 'DRY RUN (nothing written)', apply: 'APPLY', verify: 'VERIFY (nothing written)' }[report.mode];
  lines.push(`SSH secret re-encryption: ${label}`);
  lines.push(`profiles scanned: ${report.profiles}`);
  for (const { field } of LEGACY_FIELDS) {
    const r = report.fields[field];
    if (report.mode === 'verify') {
      const sourceUsable = r.source - r.undecryptable;
      lines.push(
        `  ${field.padEnd(11)} source ${sourceUsable} ${sourceUsable === r.target ? '=' : '!='} target ${r.target}` +
          `  (legacy values ${r.source}, undecryptable ${r.undecryptable}, missing or different ${r.mismatched})`,
      );
    } else {
      const copied = report.mode === 'apply' ? 'copied' : 'to copy';
      lines.push(
        `  ${field.padEnd(11)} legacy values ${r.source}: ${copied} ${r.toCopy}, already copied ${r.alreadyCopied}, ` +
          `undecryptable ${r.undecryptable}` +
          (report.mode === 'apply' ? `, failed ${r.failed}` : ''),
      );
    }
  }
  for (const issue of report.issues) {
    lines.push(`  ! profile ${issue.profileId} ${issue.field}: ${issue.reason}`);
  }
  if (report.mode === 'dry-run') {
    lines.push('Dry run only. Re-run with --apply to copy, then with --verify to compare.');
  }
  lines.push(report.clean ? 'RESULT: ok' : 'RESULT: attention needed (see the lines above)');
  return lines;
}

/** Parses argv into a mode; `--apply` and `--verify` together are refused. */
export function parseMode(argv: readonly string[]): MigrationMode {
  const apply = argv.includes('--apply');
  const verify = argv.includes('--verify');
  if (apply && verify) throw new Error('Pass --apply or --verify, not both.');
  return apply ? 'apply' : verify ? 'verify' : 'dry-run';
}

/**
 * The command: connects with `POSTGRES_*`, runs one mode, prints the report. Returns the
 * process exit code: 0 when clean, 1 when a row needs attention, 2 for a usage or
 * configuration error.
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let mode: MigrationMode;
  try {
    mode = parseMode(argv);
    // Both keys up front: the legacy key decrypts, the platform key re-encrypts. A dry
    // run needs the platform key too, because it checks which credentials already exist
    // under the same configuration the apply will use.
    assertEncryptionKeyConfigured();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid configuration');
    return 2;
  }

  let legacyKey: Buffer;
  try {
    legacyKey = getEncryptionKey();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'The legacy key is not configured');
    return 2;
  }

  registerShellkeepCredentialPurposes();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: buildDatabaseUrl() }) });
  try {
    await prisma.$connect();
    const credentials = new UserCredentialsService(prisma as never);
    const report = await migrateSshSecrets(mode, {
      prisma: prisma as unknown as ProfileSource,
      credentials,
      legacyKey,
    });
    for (const line of formatReport(report)) console.log(line);
    return report.clean ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    () => {
      // Never print the error: a connection string or a row could be in it.
      console.error('SSH secret re-encryption failed (database or key error). Nothing is logged here by design.');
      process.exit(2);
    },
  );
}
