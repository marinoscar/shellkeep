import { createCli, EXIT, exitCodeFor, formatError } from '@marinoscar/platform-cli';
import { CLI_NAME } from '@shellkeep/shared';

import { APP_CLI_OPTIONS } from './app.js';
import { runAttachBridge } from './commands/sessions-attach.js';
import { planDeployArgs } from './extensions/deploy-args.js';
import { withDefaultPort } from './extensions/default-port.js';
import { takePendingAttach } from './tui/pending-attach.js';

// =============================================================================
// One invocation of the CLI  (issue #72)
// =============================================================================
//
// `cli.ts` is the entry point and stays import-light; the work of one
// invocation lives here so a test can run it without a process exiting under
// the test runner. It builds the platform CLI over `APP_CLI_OPTIONS`, runs it,
// and then, if the TUI's Sessions screen asked for an attach, runs the terminal
// bridge in the terminal Ink has just released (Ink is not suspended in place:
// the menu exits, the bridge owns the TTY, and the process ends with the
// bridge's exit code).
//
// It returns the exit code and never calls `process.exit()`.
// =============================================================================

/**
 * `formatError`, which needs the CLI identity the platform sets while building
 * the CLI; a build that failed before that point (an invalid identity) must
 * still print its reason rather than a second error about the missing identity.
 */
export function describeError(error: unknown): string {
  try {
    return formatError(error);
  } catch {
    return error instanceof Error ? `${CLI_NAME}: ${error.message}` : `${CLI_NAME}: ${String(error)}`;
  }
}

/** Where one invocation writes; the defaults are the process's. */
export interface RunAppOptions {
  stderr?: { write(text: string): unknown } | undefined;
  cwd?: string | undefined;
  now?: (() => Date) | undefined;
  /** Builds the CLI; tests substitute a fake to observe what it is handed. */
  createCli?: typeof createCli | undefined;
}

/**
 * Runs the CLI once.
 *
 * @param argv - The arguments after the executable name.
 * @param options - Streams and seams; omit all of them to run for real.
 * @returns the exit code.
 */
export async function runApp(argv: string[], options: RunAppOptions = {}): Promise<number> {
  const stderr = options.stderr ?? process.stderr;

  // `deploy install|doctor|status` bind loopback 8323 unless --port says otherwise (#149).
  // `deploy uninstall` is guarded: typed name, `.env` backup (#150).
  const plan = planDeployArgs(withDefaultPort(argv), { cli: CLI_NAME, cwd: options.cwd ?? process.cwd(), now: options.now });
  if (plan.kind === 'refuse') {
    stderr.write(`${plan.message}\n`);
    return EXIT.USAGE;
  }
  for (const note of plan.notes) stderr.write(`${note}\n`);

  let cli: ReturnType<typeof createCli>;
  try {
    cli = (options.createCli ?? createCli)(APP_CLI_OPTIONS);
  } catch (error) {
    stderr.write(`${describeError(error)}\n`);
    return exitCodeFor(error);
  }

  for (const step of plan.before) {
    try {
      const line = step();
      if (line !== undefined) stderr.write(`${line}\n`);
    } catch (error) {
      stderr.write(`${CLI_NAME}: ${(error as Error).message}\n`);
      return EXIT.FAILURE;
    }
  }

  const code = await cli.run(plan.argv);

  const pending = takePendingAttach();
  if (pending !== undefined && code === EXIT.OK) {
    return runAttachBridge({ sessionId: pending });
  }
  return code;
}
