import { createCli, exitCodeFor, formatError } from '@marinoscar/platform-cli';
import { CLI_NAME } from '@shellkeep/shared';

import { APP_CLI_OPTIONS } from './app.js';

// =============================================================================
// One invocation of the CLI  (issue #72)
// =============================================================================
//
// `cli.ts` is the entry point and stays import-light; the work of one
// invocation lives here so a test can run it without a process exiting under
// the test runner. It builds the platform CLI over `APP_CLI_OPTIONS` and runs it.
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

  let cli: ReturnType<typeof createCli>;
  try {
    cli = (options.createCli ?? createCli)(APP_CLI_OPTIONS);
  } catch (error) {
    stderr.write(`${describeError(error)}\n`);
    return exitCodeFor(error);
  }

  return cli.run(argv);
}
