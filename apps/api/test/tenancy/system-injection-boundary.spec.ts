// =============================================================================
// Tripwires for tenant isolation (issue #52)
// =============================================================================
//
// 1. ONLY ALLOWLISTED FILES INJECT PrismaSystemService. The system client is the
//    one way to read or write across organizations: its transactions set
//    `app.rls_bypass`. A file that injects it by accident has quietly opted out of
//    tenant isolation, so every injection is a reviewed decision: the list below.
//    The scan reads every source file under src/ (specs excluded) for the class
//    name, and fails for a file that is not on the list AND for an entry that no
//    longer injects it (a stale allowlist).
//
// 2. EVERY ACCESS TO AN ORG TABLE IS ACCOUNTED FOR. The API connects as an ordinary
//    role (`shellkeep_app`) under which the forced policies of platform migration
//    0025 and later apply: an org table read through a client with no organization
//    scope returns NO ROWS, silently. So ShellKeep's own code (src/, outside the
//    packages) names an org table's Prisma delegate or SQL name only in the files
//    listed below, each of which reaches it through a scoped client or the bypass
//    client under a registered reason. The tables come from the platform's policy
//    list, so a table a later slice adds is covered without editing this file.
// =============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { BUILTIN_SYSTEM_ACCESS_REASONS } from '@marinoscar/platform-api/core';

const API_ROOT = join(__dirname, '..', '..');
const SRC = join(API_ROOT, 'src');
const SCHEMA = join(API_ROOT, 'prisma', 'schema');

/**
 * Files that may mention PrismaSystemService, each with why. Relative to
 * apps/api/src, forward slashes.
 */
const SYSTEM_ALLOWLIST: Record<string, string> = {
  'prisma/prisma-system.service.ts': 'defines it',
  'prisma/prisma.module.ts': 'provides and exports it',
  'platform/storage/storage-host.module.ts':
    "purge and admin-aggregate: the storage slice's STORAGE_SYSTEM_DATA port (#50): the stale-upload sweep, the stranded-object count of the provider-switch gate, the public avatar route and the previous avatar removed across an organization switch",
  'main.ts':
    'admin-aggregate: the startup secrets-key check counts `org_credentials` (forced row-level security) across organizations, read-only',
  'platform/db-backup/db-backup-host.module.ts':
    "doctor: the db-backup slice's DB_BACKUP_SYSTEM_DATA port (#52): the backup.rls-bypass check's read-only row counts",
  'platform/webhooks/webhooks-host.module.ts':
    "webhooks and retention: the webhooks slice's WEBHOOKS_SYSTEM_PRISMA port (#54): a system-scope endpoint and its deliveries have no organization, so only the bypass client sees them; the delivery purge crosses organizations",
  'runbooks/engine/logs-compact.handler.ts':
    "the runbook reconcile job (#62), under the registered reason `runbooks-reconcile`: it FINDS lost executors, stuck runs, expired approvals and orphan log chunks across organizations; every change is made inside the owning organization's scope",
  'platform/ai/ai-host.module.ts':
    "purge and admin-aggregate: the AI slice's AI_SYSTEM_PRISMA port (#55): the ai_runs and ai_usage_events retention purges, the deployment-wide usage report and the catalogue sync's organization-less usage row",
};

/**
 * Files outside the packages that may name an org table, each with how it stays inside the
 * rules. Relative to apps/api/src, forward slashes.
 */
const ORG_TABLE_ALLOWLIST: Record<string, string> = {
  'main.ts': "counts `org_credentials` through the bypass client, runAsSystem('admin-aggregate')",
  'platform/settings/settings-profile-images.adapter.ts':
    "reads one `storage_objects` row through STORAGE_SYSTEM_DATA.asSystem('admin-aggregate')",
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sources(full);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [full] : [];
  });
}

/** The code of a file with comments removed, so a mention in prose never counts. */
function code(file: string): string {
  return readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
}

const rel = (file: string): string => relative(SRC, file).split(sep).join('/');

describe('PrismaSystemService injection boundary', () => {
  const mentions = sources(SRC)
    .filter((file) => /\bPrismaSystemService\b/.test(code(file)))
    .map(rel)
    .sort();

  it('finds the injections (guards against a scan that matches nothing)', () => {
    expect(mentions.length).toBeGreaterThanOrEqual(4);
  });

  it('is mentioned only by allowlisted files', () => {
    expect(mentions.filter((file) => !(file in SYSTEM_ALLOWLIST))).toEqual([]);
  });

  it('has no stale allowlist entry', () => {
    expect(Object.keys(SYSTEM_ALLOWLIST).filter((file) => !mentions.includes(file))).toEqual([]);
  });

  it('is never constructed by hand outside its module (no `new PrismaSystemService`)', () => {
    const offenders = sources(SRC)
      .filter((file) => /new\s+PrismaSystemService\s*\(/.test(code(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('is never re-provided by another module', () => {
    const providers = sources(SRC)
      .filter((file) => /provide:\s*PrismaSystemService/.test(code(file)))
      .map(rel);
    expect(providers).toEqual([]);
  });

  it('gives every system acquisition a registered reason', () => {
    const reasons: readonly string[] = BUILTIN_SYSTEM_ACCESS_REASONS;
    const bad: string[] = [];
    for (const file of sources(SRC)) {
      for (const match of code(file).matchAll(/\.(?:asSystem|runAsSystem|forSystem)\(\s*'([^']*)'/g)) {
        if (!reasons.includes(match[1]!)) bad.push(`${rel(file)}: ${match[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('org table access boundary', () => {
  /** table name -> Prisma model, from the composed schema's `@@map`. */
  function modelsByTable(): Map<string, string> {
    const map = new Map<string, string>();
    for (const entry of readdirSync(SCHEMA).filter((name) => name.endsWith('.prisma'))) {
      let model: string | undefined;
      for (const line of readFileSync(join(SCHEMA, entry), 'utf8').split('\n')) {
        const open = /^model\s+(\w+)\s*\{/.exec(line);
        if (open) model = open[1];
        const mapped = /@@map\("([^"]+)"\)/.exec(line);
        if (mapped && model) map.set(mapped[1]!, model);
      }
    }
    return map;
  }

  const policyFile = join(dirname(require.resolve('@marinoscar/platform-db/package.json')), 'rls-policies.json');
  const orgTables: string[] = [
    ...new Set((JSON.parse(readFileSync(policyFile, 'utf8')) as { policies: Array<{ table: string }> }).policies.map((p) => p.table)),
  ];
  const models = modelsByTable();

  /** The table named as SQL does (`FROM groups`, `INTO "org_settings"`), not as a variable or a word. */
  const sqlNames = (table: string): RegExp =>
    new RegExp(String.raw`\b(?:FROM|JOIN|INTO|UPDATE|TABLE|TRUNCATE)\s+(?:ONLY\s+)?(?:public\.)?"?${table}"?\b`, 'i');

  it('knows the org tables and their models (guards against an empty scan)', () => {
    expect(orgTables).toEqual(expect.arrayContaining(['storage_objects', 'storage_object_chunks', 'org_settings', 'org_credentials']));
    expect(orgTables.filter((table) => !models.has(table))).toEqual([]);
  });

  it("names an org table's delegate or SQL name only in allowlisted files", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const text = code(file);
      for (const table of orgTables) {
        const delegate = models.get(table)!.replace(/^./, (c) => c.toLowerCase());
        const delegateUse = new RegExp(String.raw`\.${delegate}\b`).test(text);
        const sqlUse = sqlNames(table).test(text);
        if ((delegateUse || sqlUse) && !(rel(file) in ORG_TABLE_ALLOWLIST)) offenders.push(`${rel(file)}: ${table}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no stale org-table allowlist entry', () => {
    const stale = Object.keys(ORG_TABLE_ALLOWLIST).filter((file) => {
      const text = code(join(SRC, file));
      return !orgTables.some((table) => {
        const delegate = models.get(table)!.replace(/^./, (c) => c.toLowerCase());
        return new RegExp(String.raw`\.${delegate}\b`).test(text) || sqlNames(table).test(text);
      });
    });
    expect(stale).toEqual([]);
  });

  it('never opens a transaction on a scoped client (use runInOrg)', () => {
    const offenders = sources(SRC)
      .filter((file) => /forOrg\([^)]*\)\s*\.\$transaction\s*\(/.test(code(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('never sets the RLS flags at session level', () => {
    const offenders = sources(SRC)
      .filter((file) => /\bSET\s+(?:SESSION\s+)?app\.(?:org_id|user_id|rls_bypass)\b/i.test(code(file)) || /set_config\([^)]*,\s*(?:'[^']*'|\$\d)\s*,\s*false\s*\)/.test(code(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
