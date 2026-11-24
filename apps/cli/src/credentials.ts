import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { ApiClient, AuthRequiredError, resolveApiBaseUrl } from '@marinoscar/platform-cli/api-client';
import { ConfigError } from '@marinoscar/platform-cli/commands';
import { cliName, configDirName, configFileName, envVar } from '@marinoscar/platform-cli';

// =============================================================================
// The stored login, for ShellKeep's own commands  (issue #72)
// =============================================================================
//
// `shellkeep login` (the platform's device flow) stores the server URL and a
// personal access token in `~/.shellkeep/config.json`, mode 0600. The platform
// does not export its config reader, and the commands in this package call the
// API with `ApiClient`, so this module reads the same two fields the same way:
// the `SHELLKEEP_SERVER_URL` and `SHELLKEEP_TOKEN` environment variables win
// over the file, per field.
//
// The token goes into the client (and, for `sessions attach`, the WebSocket
// `auth` message) and nowhere else: not into argv, not into a log line, not
// into an error message.
// =============================================================================

/** What a command needs to call the API. */
export interface Credentials {
  readonly serverUrl: string;
  readonly token: string;
}

/** Where to read the config from; the defaults are the process's. */
export interface CredentialsContext {
  home?: string | undefined;
  env?: Readonly<Record<string, string | undefined>> | undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStoredFile(context: CredentialsContext): { serverUrl?: string; token?: string } {
  const path = join(context.home ?? homedir(), configDirName(), configFileName());
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new ConfigError(`Could not read ${path}: ${(cause as Error).message}`, { cause });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigError(`${path} is not valid JSON. Delete it and run \`${cliName()} login\` again.`, { cause });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(`${path} does not contain a JSON object. Delete it and run \`${cliName()} login\` again.`);
  }
  const body = parsed as Record<string, unknown>;
  const serverUrl = readString(body.serverUrl);
  const token = readString(body.token);
  return { ...(serverUrl !== undefined ? { serverUrl } : {}), ...(token !== undefined ? { token } : {}) };
}

/**
 * The server URL and token to use.
 *
 * @throws AuthRequiredError when either is missing (exit code 5).
 */
export function loadCredentials(context: CredentialsContext = {}): Credentials {
  const env = context.env ?? process.env;
  const file = readStoredFile(context);
  const serverUrl = readString(env[envVar('SERVER_URL')]) ?? file.serverUrl;
  const token = readString(env[envVar('TOKEN')]) ?? file.token;
  if (serverUrl === undefined || token === undefined) {
    throw new AuthRequiredError(
      `Not logged in. Run \`${cliName()} login\` first, or set ${envVar('SERVER_URL')} and ${envVar('TOKEN')}.`,
    );
  }
  return { serverUrl, token };
}

/** An `ApiClient` for the stored login. */
export function createApiClient(context: CredentialsContext = {}): ApiClient {
  const { serverUrl, token } = loadCredentials(context);
  return new ApiClient({ baseUrl: resolveApiBaseUrl(serverUrl), token });
}
