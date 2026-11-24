import { execFile } from 'node:child_process';

import type { DeployCheck } from '@marinoscar/platform-cli/deploy';

// =============================================================================
// The shared Docker network, reported and never demanded  (issue #72)
// =============================================================================
//
// `infra/compose/base.compose.yml` attaches `api` to `devnet` as an `external:
// true` network, so compose never creates it and refuses to start a service on
// one that is absent. The platform's install creates every network the stack's
// compose files declare external (`ensureExternalNetworks`) and has no doctor
// check for it, so `deploy doctor` on a fresh host said nothing about the one
// prerequisite whose absence produces a cryptic compose failure. This
// check reports it: a WARNING before the network exists (install is what
// creates it), a PASS after.
//
// `recommended`, not `required`: INSTALL CREATES IT, so failing a host over it would refuse the very install
// that fixes it. Docker being unavailable is a skip, not a warning: the
// `docker-daemon` check owns that diagnosis.
// =============================================================================

/** The external network every app on the host joins (`base.compose.yml`). */
export const DEVNET_NETWORK = 'devnet';

/** The check id; the CI docker job and the docs refer to it by name. */
export const DEVNET_CHECK_ID = 'docker-network-devnet';

/** Short by design: a wedged Docker socket must cost seconds, not the preflight. */
export const DOCKER_NETWORK_TIMEOUT_MS = 10_000;

/** Runs `docker <args>`; resolves with the exit code, never rejects. */
export type DockerProbe = (args: readonly string[]) => Promise<{ ok: boolean }>;

const probeDocker: DockerProbe = (args) =>
  new Promise((resolve) => {
    execFile('docker', [...args], { timeout: DOCKER_NETWORK_TIMEOUT_MS }, (error) => {
      resolve({ ok: error === null });
    });
  });

/** Builds the check; the Docker probe is a seam for the tests. */
export function createDockerNetworkCheck(probe: DockerProbe = probeDocker): DeployCheck {
  return {
    id: DEVNET_CHECK_ID,
    title: `Docker network ${DEVNET_NETWORK}`,
    severity: 'recommended',
    requires: ['docker-daemon'],
    async run() {
      const { ok } = await probe(['network', 'inspect', DEVNET_NETWORK]);
      return ok
        ? { status: 'pass', detail: 'exists' }
        : {
            status: 'warn',
            detail: 'does not exist',
            remedy: `Nothing to do: install creates it. To create it ahead of time, docker network create ${DEVNET_NETWORK}`,
          };
    },
  };
}

/** The check `createCli({ deployChecks })` registers. */
export const dockerNetworkCheck: DeployCheck = createDockerNetworkCheck();
