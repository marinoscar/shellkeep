import { validatePort, type EnvSpecFragment } from '@marinoscar/platform-cli/core';

// =============================================================================
// The environment keys only ShellKeep has  (issue #72)
// =============================================================================
//
// The platform CLI carries the metadata of its own keys (the database login, the
// session secrets, OAuth, telemetry, the optional slices). The keys of
// `infra/compose/.env.example` that are ShellKeep's own are the ones
// `infra/compose/app.env.example` declares, and each needs its metadata here, or
// the install wizard treats it generically. A key has exactly one owner: this
// fragment never repeats a platform key (`APP_BIND_PORT` is annotated in app.ts).
//
// `app.test.ts` proves every key of app.env.example has an entry here.
// =============================================================================

/** The env key naming the optional SSH egress test host (read by the `ssh-egress` deploy check). */
export const SSH_EGRESS_TEST_HOST_KEY = 'SSH_EGRESS_TEST_HOST';

function validateComposeProjectName(value: string): string | undefined {
  return /^[a-z0-9][a-z0-9_-]*$/.test(value)
    ? undefined
    : 'must start with a lowercase letter or digit and contain only lowercase letters, digits, - and _';
}

function validateSshEgressHost(value: string): string | undefined {
  return /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:\d{1,5})?$/.test(value) ? undefined : 'must be a host name, optionally with :port';
}

/** The fragment `createCli({ envSpecFragments })` registers. */
export const SHELLKEEP_ENV_SPEC: EnvSpecFragment = {
  id: 'shellkeep',
  metadata: {
    COMPOSE_PROJECT_NAME: {
      validate: validateComposeProjectName,
      help: 'The Docker Compose project name; it prefixes container, network and volume names so apps sharing a Docker host never collide. Keep shellkeep unless another deployment on this host uses it.',
    },
    NGINX_PORT: {
      validate: validatePort,
      help: 'The host port nginx publishes in the development stacks. ShellKeep uses 8323; keep APP_URL on the same port.',
    },
    ENCRYPTION_KEY: {
      secret: true,
      allowBlank: true,
      help: 'Only for a deployment that stored SSH secrets before the platform credential store: the key those legacy secrets were encrypted with, read by `npm run ssh:migrate-secrets`. Leave it empty on a new deployment. The credential store itself uses SECRETS_ENCRYPTION_KEY.',
    },
    [SSH_EGRESS_TEST_HOST_KEY]: {
      validate: validateSshEgressHost,
      allowBlank: true,
      help: 'Optional host (or host:port) the `ssh-egress` deploy check opens a TCP connection to from the api container, to prove outbound SSH works. Leave empty to skip the check.',
    },
  },
};
