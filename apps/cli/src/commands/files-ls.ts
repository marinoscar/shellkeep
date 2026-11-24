import type { Command } from 'commander';

import { type FilesDeps, resolveServer } from './files-http.js';
import { writeJson } from './output.js';

// `shellkeep files ls <server> [path] [--all] [--long] [--json]`  (issue #159)
//
// GET /api/server-profiles/:id/files?path=. The API lists directories first and caps the
// listing at 5000 entries (`truncated`). Dotfiles are hidden here unless `--all`. Output is an
// explicit field projection, like the other list commands.

interface ApiEntry {
  name: string;
  type: string;
  size: number;
  mtime: string;
  mode: string;
  symlinkTarget?: string | null;
  targetType?: string | null;
}

interface ListResponse {
  path: string;
  entries: ApiEntry[];
  truncated: boolean;
}

/** The fields `files ls` prints and the only ones `--json` carries per entry. */
export interface FileRow {
  name: string;
  type: string;
  size: number;
  mtime: string;
  mode: string;
  symlinkTarget: string | null;
  targetType: string | null;
}

/** The result of listing one directory. */
export interface Listing {
  path: string;
  truncated: boolean;
  entries: FileRow[];
}

/** Lists one directory (dotfiles only with `all`). */
export async function listFiles(deps: FilesDeps, server: string, path: string, all: boolean): Promise<Listing> {
  const id = await resolveServer(deps, server);
  const response = await deps.client().get<ListResponse>(`/server-profiles/${encodeURIComponent(id)}/files`, { query: { path } });
  return {
    path: response.path,
    truncated: response.truncated === true,
    entries: response.entries
      .filter((entry) => all || !entry.name.startsWith('.'))
      .map((entry) => ({
        name: entry.name,
        type: entry.type,
        size: entry.size,
        mtime: entry.mtime,
        mode: entry.mode,
        symlinkTarget: entry.symlinkTarget ?? null,
        targetType: entry.targetType ?? null,
      })),
  };
}

const TYPE_LETTER: Record<string, string> = { file: '-', dir: 'd', symlink: 'l' };

/** `YYYY-MM-DD HH:MM` (UTC) of an ISO time. */
export function shortTime(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso;
}

function displayName(row: FileRow, long: boolean): string {
  const isDir = row.type === 'dir' || (row.type === 'symlink' && row.targetType === 'dir');
  const suffix = isDir ? '/' : '';
  return long && row.type === 'symlink' && row.symlinkTarget !== null ? `${row.name}${suffix} -> ${row.symlinkTarget}` : `${row.name}${suffix}`;
}

/** Renders a listing as text: one name per line, or the long form. */
export function renderListing(listing: Listing, long: boolean): string {
  if (!long) return listing.entries.map((row) => displayName(row, false)).join('\n');
  const sizeWidth = Math.max(0, ...listing.entries.map((row) => String(row.size).length));
  return listing.entries
    .map((row) => `${TYPE_LETTER[row.type] ?? '?'}${row.mode}  ${String(row.size).padStart(sizeWidth)}  ${shortTime(row.mtime)}  ${displayName(row, true)}`)
    .join('\n');
}

/** Adds `ls` to the `files` group. */
export function registerFilesLs(group: Command, deps: FilesDeps): void {
  group
    .command('ls')
    .description('List a directory on a server over SFTP')
    .argument('<server>', 'server profile name or id')
    .argument('[path]', 'directory to list', '~')
    .option('-a, --all', 'include dotfiles')
    .option('-l, --long', 'show type, mode, size and modified time')
    .option('--json', 'print JSON instead of text')
    .action(async (server: string, path: string, options: { all?: boolean; long?: boolean; json?: boolean }) => {
      const listing = await listFiles(deps, server, path, options.all === true);
      if (options.json === true) {
        writeJson(deps.stdout, listing);
      } else if (listing.entries.length > 0) {
        deps.stdout.write(`${renderListing(listing, options.long === true)}\n`);
      }
      if (listing.truncated) deps.stderr.write('The listing was truncated by the server (5000 entries).\n');
    });
}

