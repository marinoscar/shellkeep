import type { Command } from 'commander';

import { type CommandDeps, fetchAllPages } from './deps.js';
import { renderTable, writeJson } from './output.js';

// `shellkeep servers list [--tag t] [--json]`  (issue #72)
//
// GET /api/server-profiles, every page. The tag filter is applied here: the
// route has no tag query. The output is projected to an explicit field list
// rather than passed through, so a field added to the response later (the
// profile row has the shape of a credential store's) cannot reach a terminal or
// a pipe by accident; the API never returns a secret, and this keeps it that way.

/** The API's server profile, the fields this command reads. */
interface ServerProfile {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  authMethod?: string;
  tags?: string[];
  color?: string | null;
  fingerprint?: string | null;
  hostKeyAlgorithm?: string | null;
  hostKeyTrustedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** The fields `servers list` prints and the only ones `--json` carries. */
export interface ServerRow {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  authMethod: string | null;
  tags: string[];
  color: string | null;
  hostKeyTrusted: boolean;
  hostKeyAlgorithm: string | null;
  hostKeyTrustedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Projects one API profile onto {@link ServerRow}. */
export function toServerRow(profile: ServerProfile): ServerRow {
  return {
    id: profile.id,
    name: profile.name,
    hostname: profile.hostname,
    port: profile.port,
    username: profile.username,
    authMethod: profile.authMethod ?? null,
    tags: profile.tags ?? [],
    color: profile.color ?? null,
    hostKeyTrusted: typeof profile.fingerprint === 'string' && profile.fingerprint.length > 0,
    hostKeyAlgorithm: profile.hostKeyAlgorithm ?? null,
    hostKeyTrustedAt: profile.hostKeyTrustedAt ?? null,
    createdAt: profile.createdAt ?? null,
    updatedAt: profile.updatedAt ?? null,
  };
}

/** Lists the caller's server profiles, optionally those carrying one tag. */
export async function listServers(deps: CommandDeps, tag: string | undefined): Promise<ServerRow[]> {
  const profiles = await fetchAllPages<ServerProfile>(deps.client(), '/server-profiles');
  const wanted = tag?.trim().toLowerCase();
  return profiles
    .map(toServerRow)
    .filter((row) => wanted === undefined || wanted === '' || row.tags.some((entry) => entry.toLowerCase() === wanted));
}

/** Adds `list` to the `servers` group. */
export function registerServersList(group: Command, deps: CommandDeps): void {
  group
    .command('list')
    .description('List your server profiles')
    .option('--tag <tag>', 'only profiles carrying this tag')
    .option('--json', 'print JSON instead of a table')
    .action(async (options: { tag?: string; json?: boolean }) => {
      const rows = await listServers(deps, options.tag);
      if (options.json === true) {
        writeJson(deps.stdout, rows);
        return;
      }
      if (rows.length === 0) {
        deps.stdout.write('No server profiles.\n');
        return;
      }
      deps.stdout.write(
        `${renderTable(
          ['ID', 'NAME', 'HOST', 'USER', 'TAGS', 'HOST KEY'],
          rows.map((row) => [
            row.id,
            row.name,
            `${row.hostname}:${row.port}`,
            row.username,
            row.tags.join(','),
            row.hostKeyTrusted ? 'trusted' : 'not trusted',
          ]),
        )}\n`,
      );
    });
}
