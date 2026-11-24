import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { Readable } from 'node:stream';

import { UsageError } from '@marinoscar/platform-cli/commands';
import { CLI_NAME } from '@shellkeep/shared';
import type { Command } from 'commander';

import { type FilesDeps, Progress, apiCode, formatBytes, readData, requestOk, resolveServer, withHint } from './files-http.js';
import { writeJson } from './output.js';

// `shellkeep files put <server> <local> <remote-dir> [--name N] [--overwrite] [--json]`  (issue #159)
//
// POST /api/server-profiles/:id/files/upload?path=<dir>&name=<name>&overwrite=<bool> with the
// raw bytes as application/octet-stream and a Content-Length (so the server can refuse an
// oversized file before it connects). The file is read as a stream, never loaded; the API
// writes to a temp name and renames, so the target never holds a half-written file. 409
// FILE_EXISTS means the name is taken: say so and point at `--overwrite`.

/** What `files put` reports (and `--json` prints). */
export interface PutResult {
  path: string;
  name: string;
  size: number;
  overwritten: boolean;
}

/** Uploads one file. */
export async function putFile(
  deps: FilesDeps,
  server: string,
  local: string,
  remoteDir: string,
  options: { name?: string | undefined; overwrite: boolean },
): Promise<PutResult> {
  const file = resolve(deps.cwd(), local);
  const info = await stat(file).catch(() => undefined);
  if (info === undefined) throw new UsageError(`${local}: no such file`);
  if (!info.isFile()) throw new UsageError(`${local} is not a regular file`);
  const name = options.name ?? basename(file);
  const id = await resolveServer(deps, server);

  const progress = new Progress(deps, 'uploading', info.size);
  let sent = 0;
  async function* source(): AsyncGenerator<Buffer> {
    for await (const chunk of createReadStream(file)) {
      sent += (chunk as Buffer).length;
      progress.update(sent);
      yield chunk as Buffer;
    }
  }
  try {
    const response = await requestOk(deps, { path: `/server-profiles/${encodeURIComponent(id)}/files/upload` }, {
      method: 'POST',
      query: { path: remoteDir, name, overwrite: options.overwrite },
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(info.size) },
      body: Readable.toWeb(Readable.from(source())) as unknown as BodyInit,
    });
    progress.finish(sent);
    return await readData<PutResult>(response);
  } catch (error) {
    progress.abort();
    if (apiCode(error) === 'FILE_EXISTS') {
      withHint(error, { FILE_EXISTS: `Use --overwrite to replace it: ${CLI_NAME} files put ${server} ${local} ${remoteDir} --overwrite` });
    }
    throw error;
  }
}

/** Adds `put` to the `files` group. */
export function registerFilesPut(group: Command, deps: FilesDeps): void {
  group
    .command('put')
    .description('Upload a local file into a directory on a server (streamed)')
    .argument('<server>', 'server profile name or id')
    .argument('<local>', 'local file to upload')
    .argument('<remote-dir>', 'directory on the server to put it in')
    .option('--name <name>', 'file name on the server (default: the local name)')
    .option('--overwrite', 'replace a file of that name if there is one')
    .option('--json', 'print JSON instead of text')
    .action(async (server: string, local: string, remoteDir: string, options: { name?: string; overwrite?: boolean; json?: boolean }) => {
      const result = await putFile(deps, server, local, remoteDir, { name: options.name, overwrite: options.overwrite === true });
      if (options.json === true) writeJson(deps.stdout, result);
      else deps.stdout.write(`${result.path} (${formatBytes(result.size)}${result.overwritten ? ', replaced' : ''})\n`);
    });
}
