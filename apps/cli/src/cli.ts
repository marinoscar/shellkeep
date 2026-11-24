#!/usr/bin/env node
import { EXIT } from '@marinoscar/platform-cli';

import { describeError, runApp } from './run.js';

// =============================================================================
// Executable entry point  (issue #72)
// =============================================================================
//
// The only module in this package with side effects at import time, and kept
// almost empty on purpose: the CLI is the platform's `createCli` over
// `APP_CLI_OPTIONS` (app.ts), run by `runApp` (run.ts).
//
// The shebang is what makes the built file directly executable once npm links
// it as `bin`; `postbuild` chmods it, because tsc does not preserve a mode it
// never set.
// =============================================================================

/**
 * Sets `process.exitCode` and returns, never `process.exit()`: exiting ends the
 * process without waiting for pending writes, and a write to a pipe is
 * asynchronous, so the version that exits truncates `| jq` the first time
 * somebody appends it.
 */
async function main(): Promise<void> {
  process.exitCode = await runApp(process.argv.slice(2));
}

// An unhandled rejection is a bug in this CLI, and Node's default response is a
// stack trace the user cannot act on: print the one-line failure every other
// error gets.
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`${describeError(reason)}\n`);
  process.exitCode = EXIT.FAILURE;
});

void main();
