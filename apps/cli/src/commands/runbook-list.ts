import type { Command } from 'commander';

import { type CommandDeps, fetchAllPages } from './deps.js';
import { renderTable, writeJson } from './output.js';

// `shellkeep runbook list [--tag t] [--search text] [--filter all|mine|shared] [--json]`  (issue #72)
//
// GET /api/runbooks, every page. The route filters on tag, text and ownership
// itself; this command passes them through. Projected to an explicit field list.

interface ApiRunbook {
  id: string;
  name: string;
  description?: string | null;
  tags?: string[];
  owner?: { kind?: string; name?: string | null } | null;
  archivedAt?: string | null;
  updatedAt?: string | null;
  latestVersion?: { version: number; createdAt?: string } | null;
}

/** The fields `runbook list` prints and the only ones `--json` carries. */
export interface RunbookRow {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  owner: string | null;
  version: number | null;
  updatedAt: string | null;
}

export const RUNBOOK_FILTERS = ['all', 'mine', 'shared'] as const;

/** Projects one API runbook onto {@link RunbookRow}. */
export function toRunbookRow(runbook: ApiRunbook): RunbookRow {
  return {
    id: runbook.id,
    name: runbook.name,
    description: runbook.description ?? null,
    tags: runbook.tags ?? [],
    owner: runbook.owner?.name ?? runbook.owner?.kind ?? null,
    version: runbook.latestVersion?.version ?? null,
    updatedAt: runbook.updatedAt ?? null,
  };
}

/** Lists the runbooks the caller may see. */
export async function listRunbooks(
  deps: CommandDeps,
  filters: { tag?: string | undefined; search?: string | undefined; filter?: string | undefined },
): Promise<RunbookRow[]> {
  const items = await fetchAllPages<ApiRunbook>(deps.client(), '/runbooks', {
    tag: filters.tag,
    q: filters.search,
    filter: filters.filter,
  });
  return items.map(toRunbookRow);
}

/** Adds `list` to the `runbook` group. */
export function registerRunbookList(group: Command, deps: CommandDeps): void {
  group
    .command('list')
    .description('List the runbooks you can see')
    .option('--tag <tag>', 'only runbooks carrying this tag')
    .option('--search <text>', 'only runbooks whose name or description contains this text')
    .option('--filter <which>', `${RUNBOOK_FILTERS.join(', ')}`, 'all')
    .option('--json', 'print JSON instead of a table')
    .action(async (options: { tag?: string; search?: string; filter?: string; json?: boolean }) => {
      const rows = await listRunbooks(deps, options);
      if (options.json === true) {
        writeJson(deps.stdout, rows);
        return;
      }
      if (rows.length === 0) {
        deps.stdout.write('No runbooks.\n');
        return;
      }
      deps.stdout.write(
        `${renderTable(
          ['ID', 'NAME', 'VERSION', 'TAGS', 'OWNER'],
          rows.map((row) => [row.id, row.name, row.version, row.tags.join(','), row.owner]),
        )}\n`,
      );
    });
}
