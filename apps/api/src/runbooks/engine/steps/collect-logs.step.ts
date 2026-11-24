// =============================================================================
// The `collect_logs` step (issue #63)
// =============================================================================
//
// ONE remote script collects the step's paths and journal units into a tar.gz, written to STDOUT. It runs
// through `SshExecutor` like every other step, so the recorded command, the host key check, the cancel and
// the timeout are the engine's own.
//
//   - NOTHING USER-CONTROLLED IS PART OF THE SCRIPT TEXT. The paths, the units, the size cap and the
//     `since` window travel as environment variables (`SK_PATHS`, `SK_UNITS` newline separated, `SK_MAX_FILE`,
//     `SK_SINCE`) in the stdin prelude, quoted by `shellQuote`. The script reads a path into a variable and
//     expands it UNQUOTED only to glob it: a variable's value is never evaluated again, so `$(reboot)` or
//     `;rm -rf /` in a path is a literal (non-matching) file name. An empty `IFS` around that one expansion keeps
//     a space in a path a space.
//   - stdout (the tar.gz) is streamed into a platform temp file; the bytes are counted and the step fails
//     `ARTIFACT_TOO_LARGE` the moment they pass `maxTotalBytes`, with nothing uploaded. stderr goes to the
//     step log (through `LogSink`, so it is redacted like every console line).
//   - The archive is then REDACTED (`tar-redact.ts`): every file passes `redactText` with the run's secret
//     literals, and a NEW tar.gz is written. Only that one is uploaded, to
//     `runbook-artifacts/<orgId>/<runId>/<targetId>/<stepIndex>.tar.gz`, and recorded as a
//     `target_archive` row with its sha256 and file count (counted from the redacted archive itself).
//   - Zero files matched: the step succeeds with a `system` line `no files matched` (and an empty archive,
//     `file_count` 0), unless `failIfEmpty` is set.
//
// A DRY RUN NEVER REACHES HERE (`runDryStep` replaces every step): a rehearsal collects nothing.
// =============================================================================

import { closeSync, openSync, writeSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { buildObjectKey } from '@marinoscar/platform-api/storage';
import { jobTempPath } from '@marinoscar/platform-api/jobs';
import type { Client } from 'ssh2';

import type { RunbookStep } from '../../schema/runbook-definition.schema';
import { FAILURE_CODES, type FailureCode } from '../engine.constants';
import type { LogSink } from '../log-sink';
import type { SshExecutor, SshExecResult } from '../ssh-executor';
import { ArchiveTooLargeError, redactTarGz } from './tar-redact';

export type CollectLogsStep = Extract<RunbookStep, { kind: 'collect_logs' }>;

/** The prefix id #50 registered for run logs and artifacts. */
export const RUNBOOK_ARTIFACTS_PREFIX = 'runbook-artifacts';

export const archiveKey = (orgId: string, runId: string, targetId: string, stepIndex: number): string =>
  buildObjectKey(RUNBOOK_ARTIFACTS_PREFIX, { orgId }, runId, targetId, `${stepIndex}.tar.gz`);

/** How much larger than `maxTotalBytes` the UNPACKED files of an archive may be (a gzip bomb stops here). */
export const MAX_EXPANSION = 10;

/**
 * The remote script. Constant text: it never contains a path, a unit or a number of the step.
 * `tail -c` keeps the LAST `SK_MAX_FILE` bytes of a file (the newest lines); a journal unit's output is cut
 * the same way. `nullglob` makes a pattern that matches nothing expand to nothing.
 */
export const COLLECT_LOGS_SCRIPT = [
  'stage=$(mktemp -d)',
  'trap \'rm -rf "$stage"\' EXIT',
  'shopt -s nullglob',
  'oifs=$IFS',
  'while IFS= read -r g; do [ -n "$g" ] || continue; IFS=; for f in $g; do [ -f "$f" ] && { tail -c "$SK_MAX_FILE" -- "$f" > "$stage/$(printf %s "$f" | tr / _)" || true; }; done; IFS=$oifs; done <<< "$SK_PATHS"',
  'while IFS= read -r u; do [ -n "$u" ] || continue; journalctl -u "$u" ${SK_SINCE:+--since "-$SK_SINCE"} --no-pager 2>&1 | tail -c "$SK_MAX_FILE" > "$stage/journal_$u.log"; done <<< "$SK_UNITS"',
  'tar -czf - -C "$stage" .',
].join('\n');

/** `24h` stays `24h`; `30m` becomes `30min` (journalctl reads `m` as months in some contexts). */
export function journalSince(since: string | undefined): string {
  if (!since) return '';
  const unit = since.slice(-1);
  const amount = since.slice(0, -1);
  return unit === 'm' ? `${amount}min` : `${amount}${unit}`;
}

/** The environment the script reads. Exposed for tests. */
export function collectLogsEnv(step: Pick<CollectLogsStep, 'paths' | 'journalUnits' | 'since' | 'maxBytesPerFile'>): Record<string, string> {
  return {
    SK_PATHS: step.paths.join('\n'),
    SK_UNITS: step.journalUnits.join('\n'),
    SK_MAX_FILE: String(step.maxBytesPerFile),
    SK_SINCE: journalSince(step.since),
  };
}

export interface CollectLogsContext {
  orgId: string;
  runId: string;
  targetId: string;
  stepIndex: number;
  client: Client;
  executor: SshExecutor;
  /** The run's cancel signal. */
  signal: AbortSignal;
  /** Parameters of the run, exported next to the `SK_*` variables. */
  params: Record<string, string>;
  secrets: Record<string, string>;
  sink: LogSink;
  profileId: string;
  stepKind: string;
  /** Records the command in the audit trail; returns the execution id. */
  recordExecution(script: string): Promise<string>;
  finishExecution(id: string, result: Pick<SshExecResult, 'exitCode' | 'signal' | 'timedOut' | 'bytes'>): Promise<void>;
  /** Uploads a local file; throws when storage fails. */
  upload(key: string, path: string, sizeBytes: number): Promise<void>;
  /** Inserts the `target_archive` row. */
  insertArtifact(row: { storageKey: string; fileCount: number; sizeBytes: number; sha256: string }): Promise<void>;
  /** Metric hook: bytes stored (`kind`: `target_archive`). */
  recordBytes?(bytes: number): void;
}

export interface CollectLogsOutcome {
  status: 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
  code?: FailureCode;
  exitCode: number | null;
}

const removeQuietly = (path: string): Promise<void> => unlink(path).catch(() => undefined);

export async function runCollectLogs(ctx: CollectLogsContext, step: CollectLogsStep): Promise<CollectLogsOutcome> {
  const { sink } = ctx;
  const raw = jobTempPath('.tar.gz');
  const redacted = jobTempPath('.tar.gz');
  const fail = (code: FailureCode, line: string, exitCode: number | null = null): CollectLogsOutcome => {
    sink.system(`${line}\n`);
    return { status: 'failed', code, exitCode };
  };

  sink.system(`Collecting ${step.paths.length} path(s) and ${step.journalUnits.length} journal unit(s)\n`);
  const executionId = await ctx.recordExecution(COLLECT_LOGS_SCRIPT);

  // The archive streams into a temp file; the total is enforced while it arrives.
  const controller = new AbortController();
  const forward = (): void => controller.abort();
  if (ctx.signal.aborted) controller.abort();
  else ctx.signal.addEventListener('abort', forward, { once: true });
  const fd = openSync(raw, 'w', 0o600);
  let received = 0;
  let tooLarge = false;
  let closed = false;

  try {
    let result: SshExecResult;
    try {
      result = await ctx.executor.exec(ctx.client, {
        script: COLLECT_LOGS_SCRIPT,
        interpreter: 'bash',
        strict: false,
        env: { ...ctx.params, ...collectLogsEnv(step) },
        secrets: ctx.secrets,
        ...(step.runAs ? { runAs: { sudo: step.runAs.sudo, ...(step.runAs.user ? { user: step.runAs.user } : {}) } } : {}),
        timeoutSec: step.timeoutSec,
        signal: controller.signal,
        onChunk: (chunk) => {
          if (chunk.stream === 'stderr') {
            sink.push('stderr', chunk.data);
            return;
          }
          if (tooLarge) return;
          received += chunk.data.length;
          if (received > step.maxTotalBytes) {
            tooLarge = true;
            controller.abort();
            return;
          }
          writeSync(fd, chunk.data);
        },
        span: { stepKind: ctx.stepKind, stepIndex: ctx.stepIndex, serverProfileId: ctx.profileId },
      });
    } finally {
      closeSync(fd);
      closed = true;
      ctx.signal.removeEventListener('abort', forward);
    }
    await ctx.finishExecution(executionId, result);

    if (tooLarge) return fail(FAILURE_CODES.ARTIFACT_TOO_LARGE, `The collected logs are larger than ${step.maxTotalBytes} bytes; nothing was stored`);
    if (result.aborted) return { status: 'cancelled', code: FAILURE_CODES.CANCELLED, exitCode: result.exitCode };
    if (result.timedOut) return { status: 'timed_out', code: FAILURE_CODES.STEP_TIMED_OUT, exitCode: result.exitCode };
    if (result.sudoPasswordRequired) return fail(FAILURE_CODES.SUDO_PASSWORD_REQUIRED, 'sudo needs a password', result.exitCode);
    if (result.exitCode !== 0) return fail(FAILURE_CODES.STEP_FAILED, `The collection script exited with ${result.exitCode ?? 'no exit code'}`, result.exitCode);

    let archive;
    try {
      archive = await redactTarGz(raw, redacted, {
        secrets: Object.values(ctx.secrets),
        maxFileBytes: step.maxBytesPerFile + 1024,
        maxUnpackedBytes: step.maxTotalBytes * MAX_EXPANSION,
      });
    } catch (error) {
      if (error instanceof ArchiveTooLargeError) return fail(FAILURE_CODES.ARTIFACT_TOO_LARGE, 'The collected logs unpack to more than the step allows; nothing was stored', 0);
      return fail(FAILURE_CODES.STEP_FAILED, 'The collected archive could not be read', 0);
    }

    if (archive.files === 0) {
      sink.system('no files matched\n');
      if (step.failIfEmpty) return fail(FAILURE_CODES.STEP_FAILED, 'No file matched and failIfEmpty is set', 0);
    }

    const key = archiveKey(ctx.orgId, ctx.runId, ctx.targetId, ctx.stepIndex);
    try {
      await ctx.upload(key, redacted, archive.sizeBytes);
    } catch {
      return fail(FAILURE_CODES.INTERNAL, 'The archive could not be stored', 0);
    }
    await ctx.insertArtifact({ storageKey: key, fileCount: archive.files, sizeBytes: archive.sizeBytes, sha256: archive.sha256 });
    ctx.recordBytes?.(archive.sizeBytes);
    sink.system(`Collected ${archive.files} file(s), ${archive.sizeBytes} bytes (sha256 ${archive.sha256.slice(0, 12)})\n`);
    return { status: 'succeeded', exitCode: 0 };
  } finally {
    if (!closed) closeSync(fd);
    await removeQuietly(raw);
    await removeQuietly(redacted);
  }
}

/** sha256 of a script, for a test asserting the recorded command. */
export const COLLECT_LOGS_SCRIPT_SHA256 = createHash('sha256').update(COLLECT_LOGS_SCRIPT).digest('hex');
