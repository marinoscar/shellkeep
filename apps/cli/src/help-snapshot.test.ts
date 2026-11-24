import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCli } from '@marinoscar/platform-cli';
import { resetCliForTests } from '@marinoscar/platform-cli/testing';
import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { APP_CLI_OPTIONS } from './app.js';

// =============================================================================
// `--help` of ShellKeep's own commands, pinned  (issue #72)
// =============================================================================
//
// `__snapshots__/help-snapshot.json` holds the help text of `servers`,
// `sessions`, `runbook` and their subcommands: the flags, descriptions and order scripts
// and the README rely on. A difference here is a flag or a description someone
// changed; update the snapshot deliberately (`UPDATE_HELP_SNAPSHOT=1`), review
// the diff, and bump the CLI version (PATCH, or MINOR for a new command).
//
// The platform's own commands are not pinned here: their help is the
// platform's, and moves with the pinned `@marinoscar/platform-cli`.
//
// Commander wraps help at the output width, 80 when stdout is not a TTY (as
// under vitest), so the text is deterministic.
// =============================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(HERE, '__snapshots__', 'help-snapshot.json');
const OWN_GROUPS = ['servers', 'sessions', 'runbook'];

/** The help text of every ShellKeep command, keyed by its path (`shellkeep servers list`). */
export function collectOwnHelp(program: Command): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (command: Command, path: string): void => {
    out[path] = command.helpInformation();
    for (const child of command.commands) visit(child, `${path} ${child.name()}`);
  };
  for (const name of OWN_GROUPS) {
    const group = program.commands.find((command) => command.name() === name);
    if (group !== undefined) visit(group, `${program.name()} ${name}`);
  }
  return out;
}

describe('--help of the ShellKeep commands', () => {
  resetCliForTests();
  const actual = collectOwnHelp(createCli(APP_CLI_OPTIONS).program);
  resetCliForTests();

  if (process.env.UPDATE_HELP_SNAPSHOT === '1' || !existsSync(SNAPSHOT_PATH)) {
    mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(actual, null, 2)}\n`);
  }
  const expected = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Record<string, string>;

  it('covers the same commands, in the same order', () => {
    expect(Object.keys(actual)).toEqual(Object.keys(expected));
    expect(Object.keys(actual)).toEqual([
      'shellkeep servers',
      'shellkeep servers list',
      'shellkeep servers test',
      'shellkeep sessions',
      'shellkeep sessions list',
      'shellkeep sessions attach',
      'shellkeep runbook',
      'shellkeep runbook list',
      'shellkeep runbook run',
      'shellkeep runbook status',
      'shellkeep runbook logs',
    ]);
  });

  for (const path of Object.keys(expected)) {
    it(`\`${path} --help\` is unchanged`, () => {
      expect(actual[path]).toBe(expected[path]);
    });
  }
});
