import type { CliCommandRegistration } from '@marinoscar/platform-cli/core';

import { type CommandDeps, defaultDeps } from './deps.js';
import { registerServersList } from './servers-list.js';
import { registerServersTest } from './servers-test.js';

/**
 * The `servers` group: `list` and `test`.
 *
 * @param deps - the API and output seams; omit them to run for real.
 */
export function serversCommand(deps?: CommandDeps): CliCommandRegistration {
  return (program) => {
    const resolved = deps ?? defaultDeps();
    const group = program.command('servers').description('Your SSH server profiles');
    registerServersList(group, resolved);
    registerServersTest(group, resolved);
  };
}
