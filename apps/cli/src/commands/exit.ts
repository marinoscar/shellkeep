import { type ExitCode } from '@marinoscar/platform-cli';
import { CliError } from '@marinoscar/platform-cli/commands';

/**
 * A command that ends with a specific exit code and one stderr line.
 *
 * The platform maps a thrown `CliError` to `exitCode` and prints
 * `<cli>: <message>`; throwing this is how an app command chooses its own code
 * (`sessions attach`: 2, 3, 4; `servers test`: 1) without calling
 * `process.exit()`.
 */
export class CommandExit extends CliError {
  readonly exitCode: ExitCode;

  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode as ExitCode;
  }
}
