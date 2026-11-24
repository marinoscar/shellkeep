// =============================================================================
// ShellKeep's own export sources never read or emit a secret (issue #68)
// =============================================================================
//
// The platform's `exports` conformance suite proves `user-data`; this spec proves the three sources
// ShellKeep registers (`server-profiles`, `terminal-sessions`, `runbook-runs`), over the real datamodel
// and EVERY writer (json, csv zip, xlsx):
//
//   - the fake client returns EVERY column of every model with a sentinel, ignoring `select`, so a
//     column a source forgot to leave out would reach the output; none of the credential columns
//     (`encryptedPassword`, `encryptedPrivateKey`, `encryptedPassphrase`), the host-key trust fields or
//     the AI switch does;
//   - the query's `select` names exactly the allowlisted columns, so a credential is not even read;
//   - every query carries the requester's own filter.
//
// The real-database counterpart, with real ciphertext, is `exports.db.spec.ts`.
// =============================================================================

import '../../src/shellkeep.manifest';
import '../../src/app-registrations/registrations';

import { Prisma } from '@prisma/client';
import {
  CSV_EXPORT_WRITER,
  JSON_EXPORT_WRITER,
  XLSX_EXPORT_WRITER,
  exportSourceRegistry,
  type ExportContext,
  type ExportDb,
  type ExportSource,
  type ExportWriter,
} from '@marinoscar/platform-api/exports';
import { collectExportOutput, exportFileText, exportSentinel, sentinelExportDb } from '@marinoscar/platform-api/exports/testing';

import '../../src/platform/exports/exports.config';
import {
  SERVER_PROFILES_EXPORT_SOURCE,
  SERVER_PROFILE_EXPORT_COLUMNS,
  serverProfilesExportRequestSchema,
} from '../../src/server-profiles/export/server-profiles.export-source';
import {
  TERMINAL_SESSIONS_EXPORT_SOURCE,
  TERMINAL_SESSION_EXPORT_COLUMNS,
  nextDay,
  terminalSessionsExportRequestSchema,
} from '../../src/terminal/export/terminal-sessions.export-source';
import {
  RUNBOOK_RUNS_EXPORT_SOURCE,
  runbookRunsExportRequestSchema,
} from '../../src/runbooks/export/runbook-runs.export-source';

const SUBJECT = '33333333-3333-4333-8333-cccccccccccc';
const WRITERS: readonly ExportWriter[] = [JSON_EXPORT_WRITER, CSV_EXPORT_WRITER, XLSX_EXPORT_WRITER];

interface Recorded {
  model: string;
  args: { where: unknown; select: Record<string, true> };
}

/** The sentinel client, with every `findMany` recorded. */
function recordingDb(): { db: ExportDb; calls: Recorded[] } {
  const base = sentinelExportDb(Prisma.dmmf.datamodel);
  const calls: Recorded[] = [];
  const db: Record<string, unknown> = {};
  for (const [name, delegate] of Object.entries(base)) {
    db[name] = {
      ...(delegate as object),
      findMany: (args: Recorded['args']) => {
        calls.push({ model: name, args });
        return (delegate as { findMany(a: unknown): Promise<unknown[]> }).findMany(args);
      },
    };
  }
  return { db, calls };
}

function contextOf(db: ExportDb): ExportContext {
  return {
    exportId: '44444444-4444-4444-8444-dddddddddddd',
    scope: 'user',
    subjectId: SUBJECT,
    requestedById: SUBJECT,
    db,
    datamodel: Prisma.dmmf.datamodel,
    pageSize: 500,
    now: new Date('2026-11-24T10:00:00.000Z'),
    timeZone: 'UTC',
  };
}

/** Every credential and trust column of a server profile: none may leave the server. */
const FORBIDDEN_PROFILE_FIELDS = [
  'encryptedPassword',
  'encryptedPrivateKey',
  'encryptedPassphrase',
  'hostKeyAlgorithm',
  'hostKeyTrustedAt',
  'hostKeyTrustedBy',
  'facts',
  'factsProbedAt',
  'aiOutputSharing',
] as const;

/** Runs the source through every writer, each on a fresh client (the sentinel client serves its row once). */
async function outputsOf(source: ExportSource<any>, request: unknown, calls: Recorded[] = []): Promise<string[]> {
  const req = source.requestSchema.parse(request);
  const texts: string[] = [];
  for (const writer of WRITERS) {
    const recording = recordingDb();
    const { bytes } = await collectExportOutput(writer, source.collect(contextOf(recording.db), req), source.id);
    texts.push(exportFileText(bytes));
    calls.push(...recording.calls);
  }
  return texts;
}

describe('ShellKeep export sources', () => {
  it('registers the three sources with their permissions', () => {
    const byId = new Map(exportSourceRegistry.list().map((source) => [source.id, source]));
    expect(byId.get('server-profiles')).toMatchObject({ scope: 'user', permission: 'servers:read' });
    expect(byId.get('terminal-sessions')).toMatchObject({ scope: 'user', permission: 'sessions:read' });
    expect(byId.get('runbook-runs')).toMatchObject({ scope: 'user', permission: 'runbooks:read' });
  });

  it('refuses an unknown request field on every source (strict schemas)', () => {
    expect(serverProfilesExportRequestSchema.safeParse({ includeShared: true, extra: 1 }).success).toBe(false);
    expect(terminalSessionsExportRequestSchema.safeParse({ from: '2026-01-01', to: '2026-01-02', extra: 1 }).success).toBe(false);
    expect(runbookRunsExportRequestSchema.safeParse({ from: '2026-01-01', to: '2026-01-02', extra: 1 }).success).toBe(false);
  });

  it('validates the date range and the optional filters', () => {
    expect(terminalSessionsExportRequestSchema.safeParse({ from: '2026-02-01', to: '2026-01-01' }).success).toBe(false);
    expect(terminalSessionsExportRequestSchema.safeParse({ from: '2026-01-01', to: '2026-01-31', status: 'detached' }).success).toBe(true);
    expect(terminalSessionsExportRequestSchema.safeParse({ from: '2026-01-01', to: '2026-01-31', status: 'bogus' }).success).toBe(false);
    expect(runbookRunsExportRequestSchema.safeParse({ from: '2026-01-01', to: '2026-01-31', runbookId: 'not-a-uuid' }).success).toBe(false);
    expect(nextDay('2026-02-28')).toBe('2026-03-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
  });

  describe('server-profiles', () => {
    it('lists only allowlisted columns, none a credential', () => {
      const keys = SERVER_PROFILE_EXPORT_COLUMNS.map((column) => column.key);
      expect(keys).toEqual(
        expect.arrayContaining(['name', 'hostname', 'port', 'username', 'authMethod', 'tags', 'color', 'fingerprint', 'createdAt', 'updatedAt']),
      );
      for (const field of FORBIDDEN_PROFILE_FIELDS) expect(keys).not.toContain(field);
      for (const key of keys) expect(key).not.toMatch(/password|passphrase|privateKey|secret|ciphertext|encrypted/i);
    });

    it('emits no credential sentinel in any writer, though the client returns every column', async () => {
      const texts = await outputsOf(SERVER_PROFILES_EXPORT_SOURCE, {});
      expect(texts).toHaveLength(3);
      for (const text of texts) {
        for (const field of FORBIDDEN_PROFILE_FIELDS) expect(text).not.toContain(exportSentinel('ServerProfile', field));
        expect(text).toContain(exportSentinel('ServerProfile', 'name'));
        expect(text).toContain(exportSentinel('ServerProfile', 'fingerprint'));
        expect(text).toContain(exportSentinel('ServerProfile', 'hostname'));
      }
    });

    it('selects exactly the allowlist and filters on the requester', async () => {
      const calls: Recorded[] = [];
      await outputsOf(SERVER_PROFILES_EXPORT_SOURCE, {}, calls);
      const profileCalls = calls.filter((call) => call.model === 'serverProfile');
      expect(profileCalls.length).toBeGreaterThan(0);
      for (const call of profileCalls) {
        const selected = Object.keys(call.args.select);
        for (const field of FORBIDDEN_PROFILE_FIELDS) expect(selected).not.toContain(field);
        expect(selected.sort()).toEqual(
          [...new Set(['id', 'userId', ...SERVER_PROFILE_EXPORT_COLUMNS.map((c) => c.key).filter((key) => key !== 'access')])].sort(),
        );
        expect(call.args.where).toEqual({ userId: SUBJECT });
      }
      // The credential store is never consulted.
      expect(calls.map((call) => call.model)).not.toContain('userCredential');
    });

    it('with includeShared, adds the profiles shared with the requester and never reads a credential', async () => {
      const calls: Array<{ where: unknown; select: Record<string, true> }> = [];
      const ORG = '55555555-5555-4555-8555-eeeeeeeeeeee';
      const GROUP = '66666666-6666-4666-8666-ffffffffffff';
      const SHARED_ID = '77777777-7777-4777-8777-aaaaaaaaaaaa';
      const db = {
        membership: { findMany: async () => [{ orgId: ORG }] },
        groupMember: { findMany: async () => [{ groupId: GROUP, orgId: ORG, role: 'viewer' }] },
        grant: { groupBy: async () => [{ resourceId: SHARED_ID }] },
        serverProfile: {
          findMany: async (args: { where: unknown; select: Record<string, true> }) => {
            calls.push(args);
            return [];
          },
        },
      } as unknown as ExportDb;
      const ctx = contextOf(db);
      const req = SERVER_PROFILES_EXPORT_SOURCE.requestSchema.parse({ includeShared: true });
      for await (const table of SERVER_PROFILES_EXPORT_SOURCE.collect(ctx, req)) {
        for await (const _row of table.rows) void _row;
      }
      expect(calls).toHaveLength(1);
      const where = JSON.stringify(calls[0]!.where);
      expect(where).toContain(SUBJECT);
      expect(where).toContain(SHARED_ID);
      expect(where).toContain(GROUP);
      expect(Object.keys(calls[0]!.select)).not.toContain('encryptedPassword');
    });
  });

  describe('terminal-sessions', () => {
    it('exports metadata only, with the tmux session name and never any terminal content', async () => {
      const calls: Recorded[] = [];
      const texts = await outputsOf(TERMINAL_SESSIONS_EXPORT_SOURCE, { from: '2026-01-01', to: '2026-01-31' }, calls);
      const keys = TERMINAL_SESSION_EXPORT_COLUMNS.map((column) => column.key);
      expect(keys).toContain('tmuxSessionId');
      expect(keys.join()).not.toMatch(/scrollback|output|content|log|buffer|history/i);
      for (const text of texts) {
        expect(text).toContain(exportSentinel('TerminalSession', 'tmuxSessionId'));
        expect(text).toContain(exportSentinel('TerminalSession', 'name'));
        expect(text).not.toContain(exportSentinel('TerminalSession', 'userId'));
        expect(text).not.toContain(exportSentinel('TerminalSession', 'orgId'));
      }
      const call = calls.find((c) => c.model === 'terminalSession')!;
      expect(Object.keys(call.args.select).sort()).toEqual([...keys].sort());
    });

    it('filters on the requester, the inclusive day range in the requester zone and the status', async () => {
      const calls: Recorded[] = [];
      await outputsOf(TERMINAL_SESSIONS_EXPORT_SOURCE, { from: '2026-01-01', to: '2026-01-31', status: 'detached' }, calls);
      const where = calls.find((c) => c.model === 'terminalSession')!.args.where as {
        userId: string;
        status: string;
        createdAt: { gte: Date; lt: Date };
      };
      expect(where.userId).toBe(SUBJECT);
      expect(where.status).toBe('detached');
      expect(where.createdAt.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(where.createdAt.lt.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    });
  });

  describe('runbook-runs', () => {
    it('is registered and exports no dataset until the run tables exist (#62), reading nothing', async () => {
      const { db, calls } = recordingDb();
      const ctx = contextOf(db);
      const req = RUNBOOK_RUNS_EXPORT_SOURCE.requestSchema.parse({ from: '2026-01-01', to: '2026-01-31' });
      const tables = [];
      for await (const table of RUNBOOK_RUNS_EXPORT_SOURCE.collect(ctx, req)) tables.push(table);
      expect(tables).toEqual([]);
      expect(calls).toEqual([]);
    });

    it('writes a well-formed (empty) file in every format', async () => {
      const texts = await outputsOf(RUNBOOK_RUNS_EXPORT_SOURCE, { from: '2026-01-01', to: '2026-01-31' });
      expect(texts).toHaveLength(3);
    });
  });
});
