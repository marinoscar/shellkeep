import { UsageError } from '@marinoscar/platform-cli/commands';
import type { Command } from 'commander';

import { type CommandDeps, fetchAllPages } from './deps.js';
import { renderTable, writeJson } from './output.js';

// `shellkeep sessions list [--status active]`  (issue #72)
//
// GET /api/sessions, every page. Projected to an explicit field list, like
// `servers list`: the session row carries the tmux session name, which is
// internal and not something to hand to scripts.

/** The statuses the route filters on. */
export const SESSION_STATUSES = ['active', 'detached', 'terminated', 'all'] as const;
export type SessionStatusFilter = (typeof SESSION_STATUSES)[number];

interface TerminalSession {
  id: string;
  name: string;
  status: string;
  serverProfileId: string;
  cols?: number;
  rows?: number;
  lastActivityAt?: string;
  createdAt?: string;
  serverProfile?: { name: string; hostname: string; port: number; username: string } | null;
}

/** The fields `sessions list` prints and the only ones `--json` carries. */
export interface SessionRow {
  id: string;
  name: string;
  status: string;
  serverProfileId: string;
  server: { name: string; hostname: string; port: number; username: string } | null;
  cols: number | null;
  rows: number | null;
  lastActivityAt: string | null;
  createdAt: string | null;
}

/** Projects one API session onto {@link SessionRow}. */
export function toSessionRow(session: TerminalSession): SessionRow {
  return {
    id: session.id,
    name: session.name,
    status: session.status,
    serverProfileId: session.serverProfileId,
    server:
      session.serverProfile === undefined || session.serverProfile === null
        ? null
        : {
            name: session.serverProfile.name,
            hostname: session.serverProfile.hostname,
            port: session.serverProfile.port,
            username: session.serverProfile.username,
          },
    cols: session.cols ?? null,
    rows: session.rows ?? null,
    lastActivityAt: session.lastActivityAt ?? null,
    createdAt: session.createdAt ?? null,
  };
}

/** Lists the caller's terminal sessions. */
export async function listSessions(deps: CommandDeps, status: SessionStatusFilter | undefined): Promise<SessionRow[]> {
  const sessions = await fetchAllPages<TerminalSession>(
    deps.client(),
    '/sessions',
    status !== undefined ? { status } : {},
  );
  return sessions.map(toSessionRow);
}

/** Adds `list` to the `sessions` group. */
export function registerSessionsList(group: Command, deps: CommandDeps): void {
  group
    .command('list')
    .description('List your terminal sessions')
    .option('--status <status>', `filter by status (${SESSION_STATUSES.join(', ')})`)
    .option('--json', 'print JSON instead of a table')
    .action(async (options: { status?: string; json?: boolean }) => {
      if (options.status !== undefined && !(SESSION_STATUSES as readonly string[]).includes(options.status)) {
        throw new UsageError(`--status must be one of ${SESSION_STATUSES.join(', ')}`);
      }
      const rows = await listSessions(deps, options.status as SessionStatusFilter | undefined);
      if (options.json === true) {
        writeJson(deps.stdout, rows);
        return;
      }
      if (rows.length === 0) {
        deps.stdout.write('No sessions.\n');
        return;
      }
      deps.stdout.write(
        `${renderTable(
          ['ID', 'NAME', 'STATUS', 'SERVER', 'LAST ACTIVITY'],
          rows.map((row) => [row.id, row.name, row.status, row.server?.name ?? row.serverProfileId, row.lastActivityAt]),
        )}\n`,
      );
    });
}
