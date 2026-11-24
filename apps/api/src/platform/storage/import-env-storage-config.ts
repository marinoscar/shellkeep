// =============================================================================
// `npm run storage:import-env`: one-off import of the previous build's storage
// environment variables (issue #50)
// =============================================================================
//
// Before #50 the provider came from the environment: `STORAGE_PROVIDER`,
// `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`,
// `AWS_SECRET_ACCESS_KEY` and `STORAGE_PART_SIZE`. The platform forbids that
// (two sources of truth): storage is runtime configuration, edited at
// `/admin/settings/storage`, with the secret access key in the encrypted
// credential store. This command reads the old variables ONCE and writes them
// through the storage configuration service (`StorageConfigAdminService.replace`,
// the same path the admin page uses), so the deployment keeps its bucket on
// the first start of the new build. Run it as a deploy step, then delete the
// variables from `.env`. Runbook: docs/runbooks/storage-configuration.md.
//
//   npm run storage:import-env                 write the configuration
//   npm run storage:import-env -- --dry-run    print what would be written, write nothing
//   npm run storage:import-env -- --user <email>
//                                              the administrator the audit row names
//                                              (default: INITIAL_ADMIN_EMAIL, else the
//                                              oldest user with the `admin` role)
//
// Exit codes: 0 written (or dry run), 1 refused or nothing to import, 2 failure.
//
// What it never does: print, log or persist a secret outside the credential
// store (it prints the key id's last four characters and "set" for the secret),
// overwrite an existing runtime configuration (it refuses), or delete a variable
// from a running deployment's `.env` (the rollback needs them; keep a copy until
// the release is verified).
//
// The mapping follows what the old provider did: with `S3_ENDPOINT` set it used
// path-style addressing against that host, which is the platform's
// `s3compatible` driver; without it, AWS's own regional host, the `s3` driver.
// `STORAGE_PART_SIZE` has no runtime setting (the part size is the slice's 10 MiB
// default); a different value is reported and ignored.
// =============================================================================

import type { INestApplicationContext } from '@nestjs/common';
import { DEFAULT_STORAGE_PART_SIZE_BYTES, StorageConfigAdminService } from '@marinoscar/platform-api/storage';
import type { StorageConfigResponse } from '@marinoscar/platform-contract/storage';

/** The variables of the previous build, read once. */
export const LEGACY_STORAGE_ENV_VARS = [
  'STORAGE_PROVIDER',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ENDPOINT',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'STORAGE_PART_SIZE',
] as const;

/** What the old environment held, trimmed; an unset or blank variable is `undefined`. */
export interface LegacyStorageEnv {
  provider?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  partSize?: string;
}

/** The body `StorageConfigAdminService.replace` takes, with the one secret it carries. */
export interface StorageImportInput {
  provider: string;
  drivers: Record<string, Record<string, unknown>>;
  secrets?: Record<string, Record<string, string>>;
}

/** What the command prints: everything but the secret's value. */
export interface StorageImportSummary {
  driver: string;
  bucket: string;
  region: string;
  endpoint: string | null;
  /** Last four characters of the access key id, or `null` when none is set. */
  accessKeyIdHint: string | null;
  secretAccessKey: 'set' | 'not set';
}

/** A plan ready to write, or the reason there is nothing to write. */
export type StorageImportPlan =
  | { kind: 'nothing'; reason: string }
  | { kind: 'invalid'; reason: string }
  | { kind: 'plan'; input: StorageImportInput; summary: StorageImportSummary; notes: string[] };

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Reads the seven legacy variables from `env`. */
export function readLegacyStorageEnv(env: NodeJS.ProcessEnv): LegacyStorageEnv {
  return {
    provider: clean(env.STORAGE_PROVIDER),
    bucket: clean(env.S3_BUCKET),
    region: clean(env.S3_REGION),
    endpoint: clean(env.S3_ENDPOINT),
    accessKeyId: clean(env.AWS_ACCESS_KEY_ID),
    secretAccessKey: clean(env.AWS_SECRET_ACCESS_KEY),
    partSize: clean(env.STORAGE_PART_SIZE),
  };
}

/**
 * Maps the legacy variables to a configuration. Pure: no I/O, so the mapping is
 * testable without a database.
 *
 * `.env.example` shipped `S3_BUCKET=your-bucket-name` and an empty key pair; the
 * placeholder bucket is treated as "nothing to import" so a deployment that never
 * configured storage does not get a configuration pointing at a bucket that does
 * not exist.
 */
export function planStorageImport(legacy: LegacyStorageEnv): StorageImportPlan {
  const provider = legacy.provider?.toLowerCase() ?? 's3';
  if (provider !== 's3') {
    return {
      kind: 'invalid',
      reason: `STORAGE_PROVIDER=${provider} is not a provider the previous build supported (only "s3"); configure storage at /admin/settings/storage`,
    };
  }
  if (!legacy.bucket || legacy.bucket === 'your-bucket-name') {
    return { kind: 'nothing', reason: 'S3_BUCKET is not set (or is the .env.example placeholder); nothing to import' };
  }

  const driver = legacy.endpoint ? 's3compatible' : 's3';
  const settings: Record<string, unknown> = { bucket: legacy.bucket };
  if (legacy.region) settings.region = legacy.region;
  if (legacy.endpoint) settings.endpoint = legacy.endpoint;
  if (legacy.accessKeyId) settings.accessKeyId = legacy.accessKeyId;

  const notes: string[] = [];
  if (!legacy.accessKeyId || !legacy.secretAccessKey) {
    notes.push(
      'AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not both set; the key pair must be entered at /admin/settings/storage before uploads work',
    );
  }
  if (legacy.partSize !== undefined && Number(legacy.partSize) !== DEFAULT_STORAGE_PART_SIZE_BYTES) {
    notes.push(
      `STORAGE_PART_SIZE=${legacy.partSize} is ignored: the part size is the platform default of ${DEFAULT_STORAGE_PART_SIZE_BYTES} bytes (StorageModule.forRoot({ partSizeBytes }))`,
    );
  }

  const input: StorageImportInput = { provider: driver, drivers: { [driver]: settings } };
  if (legacy.secretAccessKey) input.secrets = { [driver]: { secretAccessKey: legacy.secretAccessKey } };

  return {
    kind: 'plan',
    input,
    notes,
    summary: {
      driver,
      bucket: legacy.bucket,
      region: legacy.region ?? '(driver default)',
      endpoint: legacy.endpoint ?? null,
      accessKeyIdHint: legacy.accessKeyId ? `...${legacy.accessKeyId.slice(-4)}` : null,
      secretAccessKey: legacy.secretAccessKey ? 'set' : 'not set',
    },
  };
}

/**
 * Whether a runtime storage configuration already exists: any driver with a
 * bucket, or any stored secret. Either is enough to refuse: the import never
 * overwrites what an administrator (or an earlier import) saved.
 */
export function hasRuntimeStorageConfig(current: Pick<StorageConfigResponse, 'drivers' | 'bucket' | 'descriptors'>): boolean {
  if (current.bucket) return true;
  for (const settings of Object.values(current.drivers ?? {})) {
    const bucket = (settings as Record<string, unknown>).bucket;
    if (typeof bucket === 'string' && bucket.length > 0) return true;
  }
  for (const descriptor of current.descriptors ?? []) {
    for (const field of descriptor.fields) {
      if (field.kind === 'secret' && field.hasValue) return true;
    }
  }
  return false;
}

/** The text the command prints for a plan: never a secret value. */
export function describeSummary(summary: StorageImportSummary): string[] {
  return [
    `  driver:            ${summary.driver}`,
    `  bucket:            ${summary.bucket}`,
    `  region:            ${summary.region}`,
    `  endpoint:          ${summary.endpoint ?? '(none)'}`,
    `  access key id:     ${summary.accessKeyIdHint ?? '(not set)'}`,
    `  secret access key: ${summary.secretAccessKey} (credential store, purpose "storage")`,
  ];
}

export interface StorageImportIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Resolves the administrator the audit row names, or `null` when there is none. */
export type ResolveActor = (email: string | undefined) => Promise<string | null>;

export interface StorageImportOptions {
  env: NodeJS.ProcessEnv;
  argv: readonly string[];
  /** The storage configuration service the admin page uses. */
  admin: Pick<StorageConfigAdminService, 'describeForAdmin' | 'replace'>;
  resolveActor: ResolveActor;
  io: StorageImportIo;
}

function argValue(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : undefined;
}

/**
 * The command, over injected collaborators (the booted application supplies
 * them; a spec supplies doubles).
 *
 * @returns the process exit code: 0 written or dry run, 1 refused or nothing to import, 2 invalid input.
 */
export async function runStorageEnvImport(options: StorageImportOptions): Promise<number> {
  const { env, argv, admin, io } = options;
  const dryRun = argv.includes('--dry-run');

  const plan = planStorageImport(readLegacyStorageEnv(env));
  if (plan.kind === 'nothing') {
    io.stdout(`storage:import-env: ${plan.reason}\n`);
    return 1;
  }
  if (plan.kind === 'invalid') {
    io.stderr(`storage:import-env: ${plan.reason}\n`);
    return 2;
  }

  const current = await admin.describeForAdmin();
  if (hasRuntimeStorageConfig(current)) {
    io.stderr(
      'storage:import-env: refused. A runtime storage configuration already exists (a bucket or a stored secret); ' +
        'the import never overwrites it. Change it at /admin/settings/storage, then delete the legacy variables.\n',
    );
    return 1;
  }

  io.stdout(`storage:import-env: ${dryRun ? 'would write' : 'writing'} this runtime storage configuration:\n`);
  for (const line of describeSummary(plan.summary)) io.stdout(`${line}\n`);
  for (const note of plan.notes) io.stdout(`  note: ${note}\n`);

  if (dryRun) {
    io.stdout('storage:import-env: dry run, nothing written.\n');
    return 0;
  }

  const userId = await options.resolveActor(argValue(argv, '--user') ?? clean(env.INITIAL_ADMIN_EMAIL));
  if (!userId) {
    io.stderr(
      'storage:import-env: no administrator found for the audit row. Sign in once as the initial administrator, ' +
        'or pass --user <email>.\n',
    );
    return 2;
  }

  await admin.replace(plan.input as Parameters<StorageConfigAdminService['replace']>[0], userId);
  io.stdout(
    'storage:import-env: done. Verify at /admin/settings/storage (Test connection) and in the Doctor, ' +
      'then delete STORAGE_PROVIDER, S3_*, AWS_* and STORAGE_PART_SIZE from .env (keep a copy until the release is verified).\n',
  );
  return 0;
}

/** The class and code only: a message can carry a connection string or a value. */
export function describeFailure(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name : typeof error;
  const status = (error as { status?: unknown }).status;
  return `storage:import-env failed: ${name}${typeof status === 'number' ? ` (HTTP ${status})` : ''}`;
}

/**
 * Boots the application context and runs {@link runStorageEnvImport}. The job
 * worker and the lease reaper are switched off for this process: it is a
 * one-off command, not a second worker.
 */
export async function main(argv: readonly string[]): Promise<number> {
  process.env.JOBS_WORKER_MODE ??= 'off';
  process.env.JOBS_REAPER_ENABLED ??= 'false';

  // Required here, after the environment above is set: `AppModule` reads it when it loads, and a
  // spec that imports this file for the pure functions must not boot the application.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { NestFactory } = require('@nestjs/core') as typeof import('@nestjs/core');
  const { AppModule } = require('../../app.module') as typeof import('../../app.module');
  const { PrismaService } = require('../../prisma/prisma.service') as typeof import('../../prisma/prisma.service');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const app: INestApplicationContext = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const prisma = app.get(PrismaService);
    const resolveActor: ResolveActor = async (email) => {
      if (email) {
        const named = await prisma.user.findUnique({ where: { email }, select: { id: true } });
        if (named) return named.id;
      }
      const admin = await prisma.user.findFirst({
        where: { userRoles: { some: { role: { name: 'admin' } } } },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      return admin?.id ?? null;
    };

    return await runStorageEnvImport({
      env: process.env,
      argv,
      admin: app.get(StorageConfigAdminService),
      resolveActor,
      io: {
        stdout: (text) => void process.stdout.write(text),
        stderr: (text) => void process.stderr.write(text),
      },
    });
  } finally {
    await app.close();
  }
}
