import type { DeployCheck } from '@marinoscar/platform-cli/deploy';

import { type DockerRun, execInContainer, findApiContainer, runDocker } from './docker.js';

// =============================================================================
// `tmux-on-api-image`  (issue #72)
// =============================================================================
//
// Fails when `tmux -V` does not run in the running api container. ShellKeep's
// sessions are tmux sessions, so this is the check that says whether the api
// image can run tmux itself.
//
// SEVERITY. `recommended`, not `required`: today's api image
// (apps/api/Dockerfile) installs openssl and the PostgreSQL client only, and
// the sessions' tmux runs on the REMOTE servers over SSH (the Doctor's
// `terminal.tmux.probe` checks that side), so this check reports a failure on a
// stack that works. A `required` severity would fail every preflight and
// `deploy doctor` until the image gains tmux; as `recommended` it shows in the
// checklist without blocking an install. Raise it to `required` in the commit
// that adds tmux to the api image.
//
// Before the stack runs (a first install's preflight) there is no container to
// ask: the check skips.
// =============================================================================

/** The check's id. */
export const TMUX_CHECK_ID = 'tmux-on-api-image';

/** One `tmux -V` must not hold the checklist up. */
export const TMUX_TIMEOUT_MS = 15_000;

/** Builds the check; the docker runner is a seam for the tests. */
export function createTmuxCheck(run: DockerRun = runDocker): DeployCheck {
  return {
    id: TMUX_CHECK_ID,
    title: 'tmux runs in the api container',
    severity: 'recommended',
    requires: ['docker-daemon'],
    async run(context) {
      const lookup = await findApiContainer({ deployRoot: context.deployRoot, composeProject: context.composeProject }, run);
      if (lookup.kind !== 'found') return { status: 'skip', detail: lookup.reason };

      const result = await execInContainer(lookup.id, ['tmux', '-V'], TMUX_TIMEOUT_MS, run);
      if (result.exitCode === 0) return { status: 'pass', detail: result.stdout.trim() || 'tmux found' };
      if (result.unavailable) return { status: 'skip', detail: 'Docker could not be asked' };
      return {
        status: 'fail',
        detail: 'tmux -V did not run in the api container',
        remedy: 'Add tmux to the api image (apk add --no-cache tmux in apps/api/Dockerfile) and rebuild: shellkeep deploy update',
      };
    },
  };
}

/** The check `createCli({ deployChecks })` registers. */
export const tmuxCheck: DeployCheck = createTmuxCheck();
