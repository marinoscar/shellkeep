import type { Command } from 'commander';

import { assertWritable, resolveDestination, remoteBaseName, streamToFile } from './files-download.js';
import { type FilesDeps, formatBytes, readData, requestOk, resolveServer } from './files-http.js';
import { writeJson } from './output.js';

// `shellkeep files get <server> <path> [dest] [--force] [--json]`  (issue #159)
//
// POST /api/server-profiles/:id/files/download-token `{ path }` answers a single-use token
// (60 s); GET /api/files/download/:token streams the bytes. The token is never printed. The
// file is streamed to a temp file and renamed (see files-download.ts); progress is drawn on
// stderr when it is a terminal.

/** What `files get` reports (and `--json` prints). */
export interface GetResult {
  path: string;
  dest: string;
  bytes: number;
}

/** Downloads one file. */
export async function getFile(
  deps: FilesDeps,
  server: string,
  path: string,
  dest: string | undefined,
  force: boolean,
): Promise<GetResult> {
  const id = await resolveServer(deps, server);
  const destination = await resolveDestination(deps, dest, remoteBaseName(path));
  await assertWritable(destination, force);
  const issued = await requestOk(deps, { path: `/server-profiles/${encodeURIComponent(id)}/files/download-token` }, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const { token } = await readData<{ token: string }>(issued);
  const response = await requestOk(deps, { path: `/files/download/${encodeURIComponent(token)}` });
  const bytes = await streamToFile(deps, response, destination, { force, label: 'downloading' });
  return { path, dest: destination, bytes };
}

/** Adds `get` to the `files` group. */
export function registerFilesGet(group: Command, deps: FilesDeps): void {
  group
    .command('get')
    .description('Download a file from a server to disk (streamed, written atomically)')
    .argument('<server>', 'server profile name or id')
    .argument('<path>', 'file to download')
    .argument('[dest]', 'file or existing directory to write to (default: the current directory)')
    .option('--force', 'replace an existing file')
    .option('--json', 'print JSON instead of text')
    .action(async (server: string, path: string, dest: string | undefined, options: { force?: boolean; json?: boolean }) => {
      const result = await getFile(deps, server, path, dest, options.force === true);
      if (options.json === true) writeJson(deps.stdout, result);
      else deps.stdout.write(`${result.dest} (${formatBytes(result.bytes)})\n`);
    });
}
