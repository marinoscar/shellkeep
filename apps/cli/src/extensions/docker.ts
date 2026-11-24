import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { detectComposeProject } from '@marinoscar/platform-cli/deploy';

// =============================================================================
// Talking to the running api container, for the deploy checks  (issue #72)
// =============================================================================
//
// The two ShellKeep checks that look INSIDE the stack (`tmux-on-api-image`,
// `ssh-egress`) need the api container's id and a way to run one command in it.
// Both are `docker` calls through `execFile` with an argv array, never a shell
// string, and never reject: every failure is a value, because a check's job is
// to report, not to crash the preflight.
// =============================================================================

/** The compose service the API runs as (`infra/compose/base.compose.yml`). */
export const API_SERVICE = 'api';

/** The image's WORKDIR (`apps/api/Dockerfile`). */
export const API_WORKDIR = '/app/apps/api';

/** The deploy state file the platform keeps beside the checkout (a fixed platform literal). */
const STATE_FILENAME = '.appctl-deploy.json';

/** Short by design: a wedged Docker socket must cost seconds, not the preflight. */
export const DOCKER_LOOKUP_TIMEOUT_MS = 10_000;

/** What running one docker command returned; never rejects. */
export interface DockerRunResult {
  /** The exit code, or null when the command did not run to an exit (timeout, no docker). */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** True when docker itself could not be run or asked (not installed, daemon down, timeout). */
  unavailable: boolean;
}

/** Runs `docker <args>`; resolves, never rejects. The seam of every helper here. */
export type DockerRun = (args: readonly string[], timeoutMs: number) => Promise<DockerRunResult>;

/** The real runner. */
export const runDocker: DockerRun = (args, timeoutMs) =>
  new Promise((resolve) => {
    execFile('docker', [...args], { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ exitCode: 0, stdout, stderr, unavailable: false });
        return;
      }
      const code = (error as NodeJS.ErrnoException & { code?: unknown }).code;
      const killed = (error as { killed?: boolean }).killed === true;
      resolve({
        exitCode: typeof code === 'number' ? code : null,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        unavailable: code === 'ENOENT' || killed,
      });
    });
  });

/** The outcome of looking for the api container. */
export type ApiContainerLookup =
  | { kind: 'found'; id: string; project: string }
  | { kind: 'none'; reason: string }
  | { kind: 'unavailable'; reason: string };

/** Where the lookup learns the compose project from. */
export interface ApiContainerQuery {
  deployRoot: string;
  /** The project the platform context names, when it has one. */
  composeProject?: string | undefined;
}

async function projectFromState(deployRoot: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(deployRoot, STATE_FILENAME), 'utf8'));
    if (parsed !== null && typeof parsed === 'object') {
      const project = (parsed as { composeProject?: unknown }).composeProject;
      if (typeof project === 'string' && project.length > 0) return project;
    }
  } catch {
    // No state file yet (a first install) or an unreadable one: detect below.
  }
  return undefined;
}

/**
 * The running `api` container of this deployment.
 *
 * @param query - the deploy folder and, when known, its compose project.
 * @param run - the docker seam.
 */
export async function findApiContainer(query: ApiContainerQuery, run: DockerRun = runDocker): Promise<ApiContainerLookup> {
  let project = query.composeProject ?? (await projectFromState(query.deployRoot));

  if (project === undefined) {
    const detection = await detectComposeProject(query.deployRoot, async (argv, options) => {
      const result = await run(argv.slice(argv[0] === 'docker' ? 1 : 0), options.timeoutMs ?? DOCKER_LOOKUP_TIMEOUT_MS);
      if (result.unavailable || result.exitCode !== 0) throw new Error('docker could not be asked');
      return { stdout: result.stdout };
    });
    if (detection.kind === 'unavailable') return { kind: 'unavailable', reason: 'Docker could not be asked' };
    if (detection.kind !== 'found') return { kind: 'none', reason: 'no containers of this deployment were found' };
    project = detection.project;
  }

  const result = await run(
    [
      'ps',
      '--filter',
      `label=com.docker.compose.project=${project}`,
      '--filter',
      `label=com.docker.compose.service=${API_SERVICE}`,
      '--filter',
      'status=running',
      '--quiet',
    ],
    DOCKER_LOOKUP_TIMEOUT_MS,
  );
  if (result.unavailable || result.exitCode !== 0) return { kind: 'unavailable', reason: 'Docker could not be asked' };
  const id = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return id === undefined
    ? { kind: 'none', reason: `no running ${API_SERVICE} container in project ${project}` }
    : { kind: 'found', id, project };
}

/**
 * Runs a command inside a container with a timeout.
 *
 * @param containerId - from {@link findApiContainer}.
 * @param argv - the command and its arguments, no shell.
 * @param timeoutMs - the whole command's budget.
 * @param run - the docker seam.
 */
export function execInContainer(
  containerId: string,
  argv: readonly string[],
  timeoutMs: number,
  run: DockerRun = runDocker,
): Promise<DockerRunResult> {
  return run(['exec', '--workdir', API_WORKDIR, containerId, ...argv], timeoutMs);
}
