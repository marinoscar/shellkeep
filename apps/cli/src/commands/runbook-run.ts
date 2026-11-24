import { CLI_NAME } from '@shellkeep/shared';
import { UsageError } from '@marinoscar/platform-cli/commands';
import type { Command } from 'commander';

import { CommandExit } from './exit.js';
import { writeJson } from './output.js';
import { type RunRow, dryRunPlan, renderDryRunPlan, renderRunMatrix, summarizeRun } from './runbook-model.js';
import { fetchRun } from './runbook-status.js';
import type { RunbookDeps } from './runbook-http.js';

// `shellkeep runbook run <id> --targets <ids|tag:x> [--dry-run] [--wait]`  (issue #72)
//
// POST /api/runbooks/:id/runs answers 202 `{ runId }`; the run is queued, not
// done. Without `--wait` the command prints the run id and exits 0 (the run was
// accepted). With `--wait` it polls GET /api/runbook-runs/:id until the run
// ends and exits 0 only when the run succeeded AND every target did; 1 on any
// other outcome, and 1 when `--timeout` runs out (the run keeps going).
//
// Secrets: a secret parameter takes the NAME of a stored runbook secret
// (`--secret-ref PARAM=name`), never a value; `--param` for a secret parameter
// is refused, so a value cannot end up in argv or a shell history through this
// command. The output carries no parameter values at all.
//
// `--dry-run` (issue #67): sends `dryRun: true`. The server connects to every target and checks every step
// with read-only probes (syntax, binaries, package-manager simulation, destination writable) and executes
// nothing that changes a server. The command always waits for the dry run to end, prints the per-target
// plan (`--json`: the run plus `plan`) and exits 0 only when every target would run cleanly (1 otherwise).
// A runbook with a destructive step needs no confirmation for a dry run.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The run route's target selector, the part this command fills. */
export interface TargetsBody {
  serverIds?: string[];
  tags?: { any: string[] };
}

/**
 * Parses `--targets`: comma-separated server profile ids and `tag:<name>` entries.
 *
 * @throws UsageError on an empty list or an entry that is neither.
 */
export function parseTargets(value: string): TargetsBody {
  const serverIds: string[] = [];
  const tags: string[] = [];
  for (const raw of value.split(',')) {
    const entry = raw.trim();
    if (entry === '') continue;
    if (entry.startsWith('tag:')) {
      const tag = entry.slice(4).trim();
      if (tag === '') throw new UsageError('--targets: "tag:" needs a tag name');
      tags.push(tag);
    } else if (UUID.test(entry)) {
      serverIds.push(entry);
    } else {
      throw new UsageError(`--targets: "${entry}" is neither a server id nor tag:<name>`);
    }
  }
  if (serverIds.length === 0 && tags.length === 0) throw new UsageError('--targets is empty');
  return { ...(serverIds.length > 0 ? { serverIds } : {}), ...(tags.length > 0 ? { tags: { any: tags } } : {}) };
}

/** Parses repeated `NAME=value` options. */
export function parsePairs(option: string, entries: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const equals = entry.indexOf('=');
    if (equals <= 0) throw new UsageError(`${option}: expected NAME=value, got "${entry.split('=')[0]}"`);
    out[entry.slice(0, equals)] = entry.slice(equals + 1);
  }
  return out;
}

interface ParameterDef {
  name: string;
  type: string;
}

/** Types `--param` values by the runbook's parameter definitions (the API wants numbers and booleans as such). */
export function coerceParams(values: Record<string, string>, definitions: readonly ParameterDef[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [name, text] of Object.entries(values)) {
    const definition = definitions.find((entry) => entry.name === name);
    if (definition === undefined) throw new UsageError(`--param: the runbook has no parameter ${name}`);
    switch (definition.type) {
      case 'secret':
        throw new UsageError(`--param: ${name} is a secret; use --secret-ref ${name}=<secret name> (values are never passed on the command line)`);
      case 'number': {
        const number = Number(text);
        if (text.trim() === '' || !Number.isFinite(number)) throw new UsageError(`--param: ${name} must be a number`);
        out[name] = number;
        break;
      }
      case 'boolean':
        if (text !== 'true' && text !== 'false') throw new UsageError(`--param: ${name} must be true or false`);
        out[name] = text === 'true';
        break;
      default:
        out[name] = text;
    }
  }
  return out;
}

/** What `runbook run` is asked to do. */
export interface RunOptions {
  targets?: string | undefined;
  param?: string[] | undefined;
  secretRef?: string[] | undefined;
  runbookVersion?: string | undefined;
  dryRun?: boolean | undefined;
  wait?: boolean | undefined;
  /** Seconds between polls (default 3). */
  interval?: string | undefined;
  /** Give up waiting after this many seconds (default: never). */
  timeout?: string | undefined;
  json?: boolean | undefined;
}

function positiveSeconds(option: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new UsageError(`${option} must be a positive number of seconds`);
  return seconds;
}

async function definitionParameters(deps: RunbookDeps, id: string, version: string | undefined): Promise<ParameterDef[]> {
  const path = version !== undefined ? `/runbooks/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}` : `/runbooks/${encodeURIComponent(id)}`;
  const body = await deps.client().get<{ definition?: { parameters?: ParameterDef[] }; latestVersion?: { definition?: { parameters?: ParameterDef[] } } | null }>(path);
  return body.definition?.parameters ?? body.latestVersion?.definition?.parameters ?? [];
}

/**
 * Polls a run until it ends (or the timeout passes).
 *
 * @returns the run's last state and whether it finished.
 */
export async function waitForRun(
  deps: RunbookDeps,
  runId: string,
  options: { intervalSeconds: number; timeoutSeconds?: number | undefined; onStatus?: ((run: RunRow) => void) | undefined },
): Promise<{ run: RunRow; timedOut: boolean }> {
  let waited = 0;
  let last = '';
  for (;;) {
    const run = await fetchRun(deps, runId);
    const signature = `${run.status}|${JSON.stringify(run.counts)}`;
    if (signature !== last) {
      last = signature;
      options.onStatus?.(run);
    }
    if (run.finished) return { run, timedOut: false };
    if (options.timeoutSeconds !== undefined && waited >= options.timeoutSeconds) return { run, timedOut: true };
    await deps.sleep(options.intervalSeconds * 1000);
    waited += options.intervalSeconds;
  }
}

/**
 * Starts a run, and with `--wait` follows it to the end.
 *
 * @returns the run id and, when waiting, its final state.
 */
export async function startRun(deps: RunbookDeps, id: string, options: RunOptions): Promise<{ runId: string; run?: RunRow; timedOut?: boolean }> {
  const intervalSeconds = positiveSeconds('--interval', options.interval, 3);
  const timeoutSeconds = options.timeout === undefined ? undefined : positiveSeconds('--timeout', options.timeout, 0);
  const targets = options.targets === undefined ? undefined : parseTargets(options.targets);
  const typed = parsePairs('--param', options.param ?? []);
  const secretRefs = parsePairs('--secret-ref', options.secretRef ?? []);
  let version: number | undefined;
  if (options.runbookVersion !== undefined) {
    version = Number(options.runbookVersion);
    if (!Number.isInteger(version) || version < 1) throw new UsageError('--runbook-version must be a whole number, 1 or more');
  }
  const params = Object.keys(typed).length > 0 ? coerceParams(typed, await definitionParameters(deps, id, options.runbookVersion)) : {};

  const { runId } = await deps.client().post<{ runId: string }>(`/runbooks/${encodeURIComponent(id)}/runs`, {
    ...(version !== undefined ? { version } : {}),
    params,
    secretRefs,
    ...(targets !== undefined ? { targets } : {}),
    ...(options.dryRun === true ? { dryRun: true } : {}),
  });
  // A dry run is only useful for its plan: it is always followed to the end.
  if (options.wait !== true && options.dryRun !== true) return { runId };

  const { run, timedOut } = await waitForRun(deps, runId, {
    intervalSeconds,
    timeoutSeconds,
    onStatus: (state) => deps.stderr.write(`${summarizeRun(state)}\n`),
  });
  return { runId, run, timedOut };
}

/** Adds `run <id>` to the `runbook` group. */
export function registerRunbookRun(group: Command, deps: RunbookDeps): void {
  const collect = (value: string, previous: string[] | undefined): string[] => [...(previous ?? []), value];
  group
    .command('run')
    .description('Start a run of a runbook; with --wait, exit 0 only if every target succeeds')
    .argument('<id>', 'runbook id')
    .option('--targets <list>', 'server ids and tag:<name> entries, comma-separated (default: the runbook\'s own targets)')
    .option('--param <NAME=value>', 'a parameter value (repeatable)', collect)
    .option('--secret-ref <NAME=secret>', 'a secret parameter: the name of a stored runbook secret (repeatable)', collect)
    .option('--runbook-version <n>', 'run this version (default: the latest)')
    .option('--dry-run', 'rehearse: check every step on every server with read-only probes and print the plan; nothing is executed (implies --wait)')
    .option('--wait', 'wait for the run to end')
    .option('--interval <seconds>', 'seconds between polls with --wait', '3')
    .option('--timeout <seconds>', 'stop waiting after this long (the run continues)')
    .option('--json', 'print JSON instead of text')
    .action(async (id: string, options: RunOptions) => {
      const started = await startRun(deps, id, options);
      const { run } = started;
      if (run === undefined) {
        if (options.json === true) writeJson(deps.stdout, { runId: started.runId });
        else deps.stdout.write(`Started run ${started.runId}\nFollow it with: ${CLI_NAME} runbook status ${started.runId}  |  ${CLI_NAME} runbook logs ${started.runId} --follow\n`);
        return;
      }
      if (options.json === true) {
        writeJson(deps.stdout, { ...run, timedOut: started.timedOut === true, ...(run.dryRun ? { plan: dryRunPlan(run) } : {}) });
      } else {
        deps.stdout.write(`${summarizeRun(run)}\n\n${run.dryRun ? renderDryRunPlan(run) : renderRunMatrix(run)}\n`);
      }
      if (started.timedOut === true) throw new CommandExit(`timed out waiting for run ${run.id} (still ${run.status})`, 1);
      if (!run.succeeded) throw new CommandExit(run.dryRun ? `dry run ${run.id}: ${run.status}; not every target would run cleanly` : `run ${run.id} ${run.status}: not every target succeeded`, 1);
    });
}
