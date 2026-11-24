import { UsageError } from '@marinoscar/platform-cli/commands';
import type { Command } from 'commander';

import { CommandExit } from './exit.js';
import { resolveDestination, streamToFile } from './files-download.js';
import { type FilesDeps, formatBytes, readData, requestOk, resolveServer } from './files-http.js';
import { writeJson } from './output.js';

// `shellkeep files archive <server> <path> [dest] [--no-wait] [--force] [--timeout s] [--json]`  (issue #159)
//
// POST /api/server-profiles/:id/files/archive `{ path }` queues a job that tars the folder
// (202 `{ archiveId, jobId, status }`). GET /api/files/archives/:archiveId is polled until the
// archive is `ready` (or `failed` / `expired`); GET .../download then answers a presigned URL
// (valid 15 minutes), which is streamed to disk like `files get`. The presigned URL carries a
// signature: it is fetched without the bearer token and never printed. With `--no-wait` the
// command prints the archive id and stops.

/** The status route's answer, the fields this command reads. */
interface ArchiveStatus {
  archiveId: string;
  status: 'pending' | 'running' | 'ready' | 'failed' | 'expired';
  sizeBytes: number | null;
  warning: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

/** Seconds between polls. */
export const POLL_SECONDS = 2;

/** What `files archive` reports (and `--json` prints). */
export interface ArchiveResult {
  archiveId: string;
  status: string;
  dest: string | null;
  bytes: number | null;
  warning: string | null;
}

export interface ArchiveOptions {
  wait: boolean;
  force: boolean;
  /** Give up waiting after this many seconds. */
  timeoutSeconds: number;
}

/** Requests, waits for and downloads a folder archive. */
export async function archiveFolder(
  deps: FilesDeps,
  server: string,
  path: string,
  dest: string | undefined,
  options: ArchiveOptions,
): Promise<ArchiveResult> {
  const id = await resolveServer(deps, server);
  const requested = await requestOk(deps, { path: `/server-profiles/${encodeURIComponent(id)}/files/archive` }, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const { archiveId, status: initial } = await readData<{ archiveId: string; status: string }>(requested);
  if (!options.wait) return { archiveId, status: initial, dest: null, bytes: null, warning: null };

  const started = deps.now();
  let dots = false;
  let state: ArchiveStatus;
  for (;;) {
    state = await deps.client().get<ArchiveStatus>(`/files/archives/${encodeURIComponent(archiveId)}`);
    if (state.status !== 'pending' && state.status !== 'running') break;
    if (deps.now() - started > options.timeoutSeconds * 1000) {
      if (dots) deps.stderr.write('\n');
      throw new CommandExit(`the archive is still ${state.status} after ${options.timeoutSeconds} s; it keeps building (archive id ${archiveId})`, 1);
    }
    if (deps.isTty) {
      deps.stderr.write('.');
      dots = true;
    }
    await deps.sleep(POLL_SECONDS * 1000);
  }
  if (dots) deps.stderr.write('\n');

  if (state.status === 'failed') {
    throw new CommandExit(`the archive failed: ${state.errorMessage ?? 'unknown error'}${state.errorCode !== null ? ` (${state.errorCode})` : ''}`, 1);
  }
  if (state.status === 'expired') throw new CommandExit('the archive expired before it could be downloaded; request it again', 1);
  if (state.warning !== null) deps.stderr.write(`warning: ${state.warning}\n`);

  const link = await requestOk(deps, { path: `/files/archives/${encodeURIComponent(archiveId)}/download` });
  const { url, filename } = await readData<{ url: string; filename: string }>(link);
  const destination = await resolveDestination(deps, dest, filename);
  const response = await requestOk(deps, { url });
  const bytes = await streamToFile(deps, response, destination, { force: options.force, label: 'downloading' });
  return { archiveId, status: 'ready', dest: destination, bytes, warning: state.warning };
}

/** Adds `archive` to the `files` group. */
export function registerFilesArchive(group: Command, deps: FilesDeps): void {
  group
    .command('archive')
    .description('Download a folder from a server as a tar.gz (built by a job, then streamed to disk)')
    .argument('<server>', 'server profile name or id')
    .argument('<path>', 'folder to archive')
    .argument('[dest]', 'file or existing directory to write to (default: the current directory)')
    .option('--no-wait', 'start the archive, print its id and stop')
    .option('--force', 'replace an existing file')
    .option('--timeout <seconds>', 'give up waiting after this long (default 1800)')
    .option('--json', 'print JSON instead of text')
    .action(async (server: string, path: string, dest: string | undefined, options: { wait: boolean; force?: boolean; timeout?: string; json?: boolean }) => {
      const timeout = options.timeout === undefined ? 1800 : Number(options.timeout);
      if (!Number.isFinite(timeout) || timeout <= 0) throw new UsageError('--timeout must be a positive number of seconds');
      const result = await archiveFolder(deps, server, path, dest, { wait: options.wait, force: options.force === true, timeoutSeconds: timeout });
      if (options.json === true) writeJson(deps.stdout, result);
      else if (result.dest === null) deps.stdout.write(`${result.archiveId}\n`);
      else deps.stdout.write(`${result.dest} (${formatBytes(result.bytes ?? 0)})\n`);
    });
}
