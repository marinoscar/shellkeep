import type { CliCommandRegistration } from '@marinoscar/platform-cli/core';

import { defaultRunbookDeps, type RunbookDeps } from './runbook-http.js';
import { registerRunbookList } from './runbook-list.js';
import { registerRunbookLogs } from './runbook-logs.js';
import { registerRunbookRun } from './runbook-run.js';
import { registerRunbookStatus } from './runbook-status.js';

/**
 * The `runbook` group: `list`, `run`, `status` and `logs`.
 *
 * @param deps - the API, streaming and clock seams; omit them to run for real.
 */
export function runbookCommand(deps?: RunbookDeps): CliCommandRegistration {
  return (program) => {
    const resolved = deps ?? defaultRunbookDeps();
    const group = program.command('runbook').description('Runbooks and their runs');
    registerRunbookList(group, resolved);
    registerRunbookRun(group, resolved);
    registerRunbookStatus(group, resolved);
    registerRunbookLogs(group, resolved);
  };
}
