import type { Command } from 'commander';

import type { CommandDeps } from './deps.js';
import { writeJson } from './output.js';
import { type ApiRun, type RunRow, renderRunMatrix, summarizeRun, toRunRow } from './runbook-model.js';

// `shellkeep runbook status <runId> [--json]`  (issue #72)
//
// GET /api/runbook-runs/:id, printed as a servers x steps matrix in plain text.
// Read only: the exit code is 0 whatever the run's status (use `runbook run
// --wait` for an exit code that follows the outcome).

/** Reads one run. */
export async function fetchRun(deps: CommandDeps, runId: string): Promise<RunRow> {
  return toRunRow(await deps.client().get<ApiRun>(`/runbook-runs/${encodeURIComponent(runId)}`));
}

/** Adds `status <runId>` to the `runbook` group. */
export function registerRunbookStatus(group: Command, deps: CommandDeps): void {
  group
    .command('status')
    .description('Show a run: its status and a servers x steps matrix')
    .argument('<runId>', 'the run id')
    .option('--json', 'print JSON instead of text')
    .action(async (runId: string, options: { json?: boolean }) => {
      const run = await fetchRun(deps, runId);
      if (options.json === true) {
        writeJson(deps.stdout, run);
        return;
      }
      deps.stdout.write(`${summarizeRun(run)}\n\n${renderRunMatrix(run)}\n`);
    });
}
