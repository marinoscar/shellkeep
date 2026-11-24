import type { DeployCheck } from '@marinoscar/platform-cli/deploy';

import { type DockerRun, execInContainer, findApiContainer, runDocker } from './docker.js';

// =============================================================================
// `ssh-egress`  (issue #72)
// =============================================================================
//
// A warning when the api container cannot open a TCP connection to a SSH test
// host. The API reaches every server profile from inside its container, so a
// host firewall or a Docker network that blocks outbound port 22 breaks every
// terminal while the stack looks healthy.
//
// The host is configured, not guessed: `SSH_EGRESS_TEST_HOST` in
// infra/compose/.env, `host` or `host:port` (port 22 by default). Unset means
// the check skips: there is no host of ours to probe, and probing a third
// party's would be an egress nobody asked for.
//
// The probe is one `node -e` in the api container (node is in the image); the
// host and port go as arguments, never into the script or a shell string.
// =============================================================================

/** The check's id. */
export const SSH_EGRESS_CHECK_ID = 'ssh-egress';

/** The env key naming the test host. */
export const SSH_EGRESS_ENV_KEY = 'SSH_EGRESS_TEST_HOST';

/** Per attempt; the in-container script gives up at 5 s. */
export const SSH_EGRESS_TIMEOUT_MS = 15_000;

const PROBE_SCRIPT =
  "const net=require('node:net');const [host,port]=process.argv.slice(1);" +
  'const s=net.connect({host,port:Number(port),timeout:5000});' +
  "s.on('connect',()=>{s.destroy();process.exit(0)});" +
  "s.on('timeout',()=>process.exit(2));s.on('error',()=>process.exit(3));";

/** A parsed `host[:port]`. */
export interface EgressTarget {
  host: string;
  port: number;
}

/**
 * Parses `host` or `host:port`; undefined when the value is not one.
 * IPv6 literals are not supported (use a name).
 */
export function parseEgressTarget(value: string): EgressTarget | undefined {
  const match = /^([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)(?::(\d{1,5}))?$/.exec(value.trim());
  if (match === null) return undefined;
  const port = match[3] === undefined ? 22 : Number(match[3]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  return { host: match[1] as string, port };
}

/** Builds the check; the docker runner is a seam for the tests. */
export function createSshEgressCheck(run: DockerRun = runDocker): DeployCheck {
  return {
    id: SSH_EGRESS_CHECK_ID,
    title: 'api container can open SSH connections',
    severity: 'recommended',
    requires: ['docker-daemon'],
    async run(context) {
      const configured = context.env?.get(SSH_EGRESS_ENV_KEY)?.trim() ?? '';
      if (configured === '') return { status: 'skip', detail: `${SSH_EGRESS_ENV_KEY} is not set` };

      const target = parseEgressTarget(configured);
      if (target === undefined) {
        return {
          status: 'warn',
          detail: `${SSH_EGRESS_ENV_KEY} is not a host or host:port`,
          remedy: `Set ${SSH_EGRESS_ENV_KEY} in infra/compose/.env to a host name, for example ssh-test.example.test:22`,
        };
      }

      const lookup = await findApiContainer({ deployRoot: context.deployRoot, composeProject: context.composeProject }, run);
      if (lookup.kind !== 'found') return { status: 'skip', detail: lookup.reason };

      const result = await execInContainer(
        lookup.id,
        ['node', '-e', PROBE_SCRIPT, target.host, String(target.port)],
        SSH_EGRESS_TIMEOUT_MS,
        run,
      );
      if (result.exitCode === 0) return { status: 'pass', detail: `${target.host}:${target.port} reachable` };
      if (result.unavailable) return { status: 'skip', detail: 'Docker could not be asked' };
      return {
        status: 'warn',
        detail: `${target.host}:${target.port} is not reachable from the api container`,
        remedy: 'Check outbound firewall rules for the Docker network and the host\'s own egress policy',
      };
    },
  };
}

/** The check `createCli({ deployChecks })` registers. */
export const sshEgressCheck: DeployCheck = createSshEgressCheck();
