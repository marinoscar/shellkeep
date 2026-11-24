import type { CliCommandRegistration } from '@marinoscar/platform-cli/core';

import { type CommandDeps, defaultDeps } from './deps.js';
import { type AttachDeps, registerSessionsAttach } from './sessions-attach.js';
import { registerSessionsList } from './sessions-list.js';

/**
 * The `sessions` group: `list` and `attach`.
 *
 * @param deps - the API and output seams; omit them to run for real.
 * @param attach - the terminal seams of `attach`; omit them to use the process's.
 */
export function sessionsCommand(deps?: CommandDeps, attach?: AttachDeps): CliCommandRegistration {
  return (program) => {
    const resolved = deps ?? defaultDeps();
    const group = program.command('sessions').description('Your terminal sessions');
    registerSessionsList(group, resolved);
    registerSessionsAttach(group, attach);
  };
}
