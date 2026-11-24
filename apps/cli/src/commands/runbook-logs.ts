import type { Command } from 'commander';

import { CommandExit } from './exit.js';
import { type RunbookDeps, type SseEvent, readSse } from './runbook-http.js';
import { type RunRow, isTerminalRun } from './runbook-model.js';
import { fetchRun } from './runbook-status.js';

// `shellkeep runbook logs <runId> [--target <serverId>] [--follow]`  (issue #72)
//
// Without --follow: the (already redacted) log of every started step, from
// GET /api/runbook-runs/:id/targets/:targetId/steps/:stepIndex/log, one target
// after the other.
//
// With --follow: the SSE stream, GET /api/runbook-runs/:id/logs/stream (or the
// per-target route with --target), until the run ends. Frames: `snapshot`, then
// `chunk` (SSE id `<stepRowId>:<seq>`), `step`, `target`, `run`, `approval` and a
// `heartbeat` every 15 s. A dropped connection is re-opened with `Last-Event-ID`
// set to the last chunk id received, so no chunk is repeated or lost; the wait
// between attempts doubles from 1 s to 10 s and the command gives up after
// RECONNECT_LIMIT attempts in a row that deliver nothing. The first connection
// sends a nil-uuid `Last-Event-ID`: the server cannot find that chunk and
// replays every chunk still in its table, which is how a late `--follow` sees the
// run so far. A run that already ended is dumped like the no-follow form (its
// logs are archived and no longer in the chunk table).
//
// The exit code is 0 when the stream ran to the end of the run (whatever the
// run's own outcome: `runbook status` / `runbook run --wait` report that), 1 when
// the stream could not be kept.

/** The `Last-Event-ID` that asks for everything still stored. */
export const FROM_START_EVENT_ID = '00000000-0000-0000-0000-000000000000:0';
/** Reconnect attempts in a row that deliver nothing before giving up. */
export const RECONNECT_LIMIT = 6;
const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 10_000;

/** One piece of log output, tagged with where it came from. */
interface LogEntry {
  targetId: string;
  server: string;
  stepIndex: number;
  stream: string;
  text: string;
}

/** Writes entries as text (a `[server] ` prefix when several servers are shown) or as JSON lines. */
class LogSink {
  private readonly atLineStart = new Map<string, boolean>();

  constructor(
    private readonly out: { write(text: string): unknown },
    private readonly json: boolean,
    private readonly prefix: boolean,
  ) {}

  write(entry: LogEntry): void {
    if (this.json) {
      this.out.write(`${JSON.stringify({ server: entry.server, targetId: entry.targetId, step: entry.stepIndex + 1, stream: entry.stream, data: entry.text })}\n`);
      return;
    }
    if (!this.prefix) {
      this.out.write(entry.text);
      return;
    }
    const label = `[${entry.server}] `;
    let text = '';
    let start = this.atLineStart.get(entry.targetId) ?? true;
    for (const line of entry.text.split(/(?<=\n)/)) {
      text += `${start ? label : ''}${line}`;
      start = line.endsWith('\n');
    }
    this.atLineStart.set(entry.targetId, start);
    this.out.write(text);
  }
}

/** Picks the targets `--target` names: a run target id, a server profile id or a server name. */
export function selectTargets(run: RunRow, wanted: string | undefined): RunRow['targets'] {
  if (wanted === undefined) return run.targets;
  const found = run.targets.filter((target) => target.id === wanted || target.serverId === wanted || target.server === wanted);
  if (found.length === 0) throw new CommandExit(`run ${run.id} has no target ${wanted}`, 1);
  return found;
}

async function readStepLog(deps: RunbookDeps, runId: string, targetId: string, stepIndex: number): Promise<string> {
  const response = await deps.fetch(`/runbook-runs/${encodeURIComponent(runId)}/targets/${encodeURIComponent(targetId)}/steps/${stepIndex}/log`, {
    headers: { accept: 'text/plain' },
  });
  if (!response.ok) throw new CommandExit(`could not read the log of step ${stepIndex + 1} (HTTP ${response.status})`, 1);
  return response.text();
}

/** Prints the stored log of every started step of the selected targets. */
export async function dumpLogs(deps: RunbookDeps, run: RunRow, wanted: string | undefined, json: boolean): Promise<void> {
  const targets = selectTargets(run, wanted);
  const sink = new LogSink(deps.stdout, json, targets.length > 1);
  for (const target of targets) {
    for (const step of target.steps) {
      if (step.status === 'pending') continue;
      const text = await readStepLog(deps, run.id, target.id, step.index);
      if (text !== '') sink.write({ targetId: target.id, server: target.server, stepIndex: step.index, stream: 'log', text });
    }
  }
}

/** Options of {@link followLogs}. */
export interface FollowOptions {
  json?: boolean | undefined;
  /** How long a stream that opened on an already finished run is read for its replay. Default 1000. */
  idleMs?: number | undefined;
}

interface ChunkData {
  targetId?: string;
  stepIndex?: number;
  stream?: string;
  data?: string;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Streams a run's logs until the run ends, reconnecting with `Last-Event-ID`. */
export async function followLogs(deps: RunbookDeps, runId: string, wanted: string | undefined, options: FollowOptions = {}): Promise<void> {
  const run = await fetchRun(deps, runId);
  if (run.finished) {
    await dumpLogs(deps, run, wanted, options.json === true);
    return;
  }
  const targets = selectTargets(run, wanted);
  const names = new Map(run.targets.map((target) => [target.id, target.server]));
  const sink = new LogSink(deps.stdout, options.json === true, wanted === undefined ? run.targets.length > 1 : targets.length > 1);
  const path =
    wanted !== undefined && targets.length === 1 && targets[0] !== undefined
      ? `/runbook-runs/${encodeURIComponent(runId)}/targets/${encodeURIComponent(targets[0].id)}/logs/stream`
      : `/runbook-runs/${encodeURIComponent(runId)}/logs/stream`;

  let lastEventId = FROM_START_EVENT_ID;
  let failures = 0;
  const idleMs = options.idleMs ?? 1000;

  for (;;) {
    const abort = new AbortController();
    let delivered = false;
    let finished = false;
    try {
      const response = await deps.fetch(path, { headers: { accept: 'text/event-stream', 'last-event-id': lastEventId }, signal: abort.signal });
      if (!response.ok) {
        // A refusal (not logged in, no access, no such run) will not get better by retrying; a 5xx or 429 might.
        if (response.status >= 400 && response.status < 500 && response.status !== 429 && response.status !== 408) {
          throw new CommandExit(`the log stream was refused (HTTP ${response.status})`, 1);
        }
        throw new Error(`HTTP ${response.status}`);
      }
      if (response.body === null) throw new Error('empty response');

      const iterator = readSse(response.body)[Symbol.asyncIterator]();
      let draining = false;
      for (;;) {
        let next: IteratorResult<SseEvent> | 'idle';
        if (draining) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const idle = new Promise<'idle'>((resolve) => {
            timer = setTimeout(() => resolve('idle'), idleMs);
          });
          next = await Promise.race([iterator.next(), idle]);
          clearTimeout(timer);
        } else {
          next = await iterator.next();
        }
        if (next === 'idle') {
          finished = true;
          break;
        }
        if (next.done === true) break;
        const event = next.value;
        delivered = true;
        if (event.event === 'chunk') {
          const data = parseJson(event.data) as ChunkData | undefined;
          if (data?.data !== undefined && data.targetId !== undefined) {
            sink.write({
              targetId: data.targetId,
              server: names.get(data.targetId) ?? data.targetId,
              stepIndex: data.stepIndex ?? 0,
              stream: data.stream ?? 'stdout',
              text: data.data,
            });
          }
          if (event.id !== undefined) lastEventId = event.id;
        } else if (event.event === 'snapshot') {
          const status = (parseJson(event.data) as { run?: { status?: string } } | undefined)?.run?.status;
          // The run ended while we were away: its chunks are replayed right after the snapshot, then nothing more comes.
          if (status !== undefined && isTerminalRun(status)) draining = true;
        } else if (event.event === 'run') {
          const status = (parseJson(event.data) as { status?: string } | undefined)?.status;
          if (status !== undefined && isTerminalRun(status)) {
            finished = true;
            break;
          }
        }
      }
    } catch (error) {
      if (error instanceof CommandExit) throw error;
      // A dropped connection: fall through to the reconnect below.
    } finally {
      abort.abort();
    }
    if (finished) return;
    failures = delivered ? 0 : failures + 1;
    if (failures > RECONNECT_LIMIT) throw new CommandExit(`lost the log stream of run ${runId} and could not reconnect`, 1);
    await deps.sleep(Math.min(BACKOFF_START_MS * 2 ** Math.max(0, failures - 1), BACKOFF_MAX_MS));
  }
}

/** Adds `logs <runId>` to the `runbook` group. */
export function registerRunbookLogs(group: Command, deps: RunbookDeps): void {
  group
    .command('logs')
    .description('Print the log of a run; with --follow, stream it until the run ends')
    .argument('<runId>', 'the run id')
    .option('--target <server>', 'only this server (its id or name)')
    .option('--follow', 'stream live output, reconnecting if the connection drops')
    .option('--json', 'print one JSON object per chunk instead of text')
    .action(async (runId: string, options: { target?: string; follow?: boolean; json?: boolean }) => {
      if (options.follow === true) {
        await followLogs(deps, runId, options.target, { json: options.json });
        return;
      }
      await dumpLogs(deps, await fetchRun(deps, runId), options.target, options.json === true);
    });
}
