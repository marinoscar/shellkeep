import { cliName, cliVersion } from '@marinoscar/platform-cli';
import { resolveApiBaseUrl } from '@marinoscar/platform-cli/api-client';
import type { Command } from 'commander';

import { loadCredentials } from '../credentials.js';
import {
  type BridgeOptions,
  type BridgeResult,
  ATTACH_EXIT,
  runBridge,
  terminalWsUrl,
} from '../terminal/bridge.js';

import { CommandExit } from './exit.js';

// `shellkeep sessions attach <id>`  (issue #72)
//
// Attaches this terminal to a tmux-backed session through WS /api/terminal/ws.
// The server URL and the token come from the stored login (`shellkeep login`,
// ~/.shellkeep/config.json) or SHELLKEEP_SERVER_URL / SHELLKEEP_TOKEN; the
// token is passed to the bridge in memory and travels only in the WebSocket
// `auth` message: never in argv, never printed. Ctrl-] then d detaches and
// leaves the session running.
//
// The protocol, raw mode and exit codes live in terminal/bridge.ts.

/** What an attach reaches outside itself for; tests substitute them. */
export interface AttachDeps {
  stdin: BridgeOptions['stdin'];
  stdout: BridgeOptions['stdout'];
  stderr: { write(text: string): unknown };
  /** Runs the bridge; the real one by default. */
  bridge?: ((options: BridgeOptions) => Promise<BridgeResult>) | undefined;
  /** `{ serverUrl, token }`; the stored login by default. */
  credentials?: (() => { serverUrl: string; token: string }) | undefined;
}

function defaultAttachDeps(): AttachDeps {
  return { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr };
}

/** The debug sink: `SHELLKEEP_DEBUG=1` reports frame sizes and types, never content. */
function debugSink(stderr: { write(text: string): unknown }): BridgeOptions['debug'] {
  return process.env.SHELLKEEP_DEBUG === '1' ? (line) => void stderr.write(`[attach] ${line}\n`) : undefined;
}

/**
 * Attaches to one session and returns how it ended.
 *
 * @param sessionId - the session to attach to.
 * @param deps - terminal and credential seams; omit them to use the process's.
 */
export async function attachSession(sessionId: string, deps: AttachDeps = defaultAttachDeps()): Promise<BridgeResult> {
  // Checked before the login is read: an attach from a pipe is a usage error
  // whether or not anyone is logged in, and says so first.
  if (deps.stdin.isTTY !== true) {
    return {
      code: ATTACH_EXIT.USAGE,
      message: 'sessions attach needs an interactive terminal: stdin is not a TTY.',
    };
  }
  const { serverUrl, token } = (deps.credentials ?? loadCredentials)();
  return (deps.bridge ?? runBridge)({
    url: terminalWsUrl(resolveApiBaseUrl(serverUrl)),
    token,
    sessionId,
    stdin: deps.stdin,
    stdout: deps.stdout,
    userAgent: `shellkeep/${cliVersion()}`,
    debug: debugSink(deps.stderr),
  });
}

/**
 * Runs an attach and ends it the way the command does: the one-line message on
 * stderr, and the exit code.
 *
 * @returns the exit code.
 */
export async function runAttachBridge(options: { sessionId: string; deps?: AttachDeps | undefined }): Promise<number> {
  const deps = options.deps ?? defaultAttachDeps();
  let result: BridgeResult;
  try {
    result = await attachSession(options.sessionId, deps);
  } catch (error) {
    deps.stderr.write(`${cliName()}: ${(error as Error).message}\n`);
    return ATTACH_EXIT.FAILURE;
  }
  if (result.message !== undefined) {
    deps.stderr.write(result.code === ATTACH_EXIT.OK ? `[${result.message}]\n` : `${cliName()}: ${result.message}\n`);
  }
  return result.code;
}

/** Adds `attach <id>` to the `sessions` group. */
export function registerSessionsAttach(group: Command, deps?: AttachDeps): void {
  group
    .command('attach')
    .description('Attach this terminal to a session (Ctrl-] then d detaches and leaves it running)')
    .argument('<id>', 'session id (see `sessions list`)')
    .action(async (id: string) => {
      const resolved = deps ?? defaultAttachDeps();
      const result = await attachSession(id, resolved);
      if (result.code === ATTACH_EXIT.OK) {
        if (result.message !== undefined) resolved.stderr.write(`[${result.message}]\n`);
        return;
      }
      throw new CommandExit(result.message ?? 'attach failed', result.code);
    });
}
