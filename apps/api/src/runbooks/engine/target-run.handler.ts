// =============================================================================
// `runbook.target.run` (issue #62)
// =============================================================================
//
// Runs ONE SEGMENT of a run on ONE target over ONE SSH connection: the steps from `fromStepIndex` up to
// the end of the runbook or the next pause point (an approval gate, which parks the target `waiting`).
//
// SERVER-ONLY, permanently: it carries NEITHER `nodeResultSchema` NOR `persistNodeResult`. It holds a
// decrypted server credential and the organization's runbook secrets for the whole segment; no worker
// node may ever hold either. `maxAttempts: 1`: a re-run would repeat commands that already ran, so a job
// that dies mid-step is NOT retried; the reconcile sweep fails the target with `EXECUTOR_LOST` instead.
//
// ORDER OF A SEGMENT
//   1. re-check the run (cancelling?) and the initiator (still `runbooks:run`, still allowed to use the
//      server): else the target fails `PERMISSION_REVOKED`;
//   2. decrypt the profile and the run's secrets; open the connection through `SshConnectionFactory`
//      (host key checked before any credential): HOST_KEY_UNKNOWN / HOST_KEY_MISMATCH / SSH_UNREACHABLE /
//      SSH_AUTH_FAILED;
//   3. each step: `when` decides run or skip; then by kind. After a step its status, exit code, duration
//      and output tail are stored, and a cancel is looked for;
//   4. settle the target and call `advance` IN THE SAME TRANSACTION (JobScope), then publish after the
//      commit; the SSH connection closes in `finally`.
//
// A secret value lives only in this process's memory, between its decryption and the end of the
// segment. It is never in a payload, a row, a log line, a span or an event: the sink redacts every chunk
// with the exact values.
// =============================================================================

import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { runInOrg } from '@marinoscar/platform-api/core';
import { OrgCredentialsService } from '@marinoscar/platform-api/credentials';
import { JobHandlerRegistry, JobScope, type Job, type JobHandler } from '@marinoscar/platform-api/jobs';
import type { Client, SFTPWrapper } from 'ssh2';
import { z } from 'zod';

import { redactText } from '../../command-safety';
import { PrismaService } from '../../prisma/prisma.service';
import { HostKeyError } from '../../ssh/host-key.error';
import { SshConnectionFactory } from '../../ssh/ssh-connection.factory';
import { classifySshConnectError } from '../../ssh/ssh-connect-outcome';
import { readStoredFacts } from '../../ssh/server-facts.service';
import { RUNBOOK_SECRET_PURPOSE } from '../runbooks.credentials';
import type { RunbookDefinition, RunbookStep } from '../schema/runbook-definition.schema';
import { CancelWatch } from './cancel-watch';
import { EngineAccessService, type Initiator } from './engine-access.service';
import { EngineMetricsService } from './engine-metrics.service';
import {
  COMMAND_PREVIEW_BYTES,
  FAILURE_CODES,
  MAX_UPLOAD_BYTES,
  RUNBOOK_TARGET_RUN_TYPE,
  type FailureCode,
} from './engine.constants';
import { LogArchiveService } from './log-archive.service';
import { LogSink, splitUtf8 } from './log-sink';
import { renderPackageUpdate } from './package-commands';
import { RunCoordinatorService, type OrgTx } from './run-coordinator.service';
import { RunEventsService } from './run-events.service';
import { RunLifecycleService } from './run-lifecycle.service';
import { RunFileError, RunFileSource } from './run-file-source';
import { RunbookSettingsService } from './runbook-settings.service';
import { SshExecutor, sha256Hex, shellQuote, type SshExecRequest } from './ssh-executor';
import { assertTransition } from './state-machine';

export const TARGET_RUN_PAYLOAD = z.object({
  runId: z.string().uuid(),
  targetId: z.string().uuid(),
  fromStepIndex: z.number().int().min(0),
});

type StepStatus = 'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'waiting_approval';

interface StepOutcome {
  status: StepStatus;
  code?: FailureCode;
}

/** Everything one segment needs, loaded once. */
interface Segment {
  job: Job;
  orgId: string;
  runId: string;
  targetId: string;
  definition: RunbookDefinition;
  initiator: Initiator;
  params: Record<string, string>;
  secrets: Record<string, string>;
  maxLogBytes: number;
  allowSelfApproval: boolean;
  target: { serverProfileId: string | null };
  client: Client;
  watch: CancelWatch;
  facts: { packageManager?: string } | null;
  profileId: string;
  rows: Map<number, { id: string; status: string }>;
}

const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'error');

/** The failure code of an SSH connect error. */
export function connectFailureCode(error: unknown): FailureCode {
  const outcome = classifySshConnectError(error);
  if (outcome === 'host_key_unknown') return FAILURE_CODES.HOST_KEY_UNKNOWN;
  if (outcome === 'host_key_mismatch') return FAILURE_CODES.HOST_KEY_MISMATCH;
  if (outcome === 'auth_failed') return FAILURE_CODES.SSH_AUTH_FAILED;
  return FAILURE_CODES.SSH_UNREACHABLE;
}

@Injectable()
export class TargetRunHandler implements JobHandler, OnModuleInit {
  readonly type = RUNBOOK_TARGET_RUN_TYPE;
  readonly label = 'Run a runbook on one server';
  // 4 hours: the segment budget of the definition schema. One attempt: commands must not run twice.
  readonly profile = { maxRuntimeMs: 4 * 3_600_000, maxAttempts: 1 } as const;

  private readonly logger = new Logger(TargetRunHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
    private readonly jobScope: JobScope,
    private readonly coordinator: RunCoordinatorService,
    private readonly lifecycle: RunLifecycleService,
    private readonly access: EngineAccessService,
    private readonly factory: SshConnectionFactory,
    private readonly executor: SshExecutor,
    private readonly archive: LogArchiveService,
    private readonly events: RunEventsService,
    private readonly settings: RunbookSettingsService,
    private readonly credentials: OrgCredentialsService,
    private readonly files: RunFileSource,
    private readonly metrics: EngineMetricsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  private inOrg<T>(orgId: string, fn: (tx: OrgTx) => Promise<T>): Promise<T> {
    return runInOrg(this.prisma, { orgId }, fn);
  }

  async process(job: Job): Promise<void> {
    const payload = TARGET_RUN_PAYLOAD.parse(job.payload);
    const orgId = job.orgId;
    if (!orgId) throw new Error('runbook.target.run needs an organization');
    const startedAt = Date.now();

    const loaded = await this.inOrg(orgId, async (tx) => {
      const [run, target, steps] = await Promise.all([
        tx.runbookRun.findUnique({ where: { id: payload.runId } }),
        tx.runbookRunTarget.findUnique({ where: { id: payload.targetId } }),
        tx.runbookRunStep.findMany({ where: { runTargetId: payload.targetId }, orderBy: { stepIndex: 'asc' } }),
      ]);
      if (!run || !target) return null;
      const version = await tx.runbookVersion.findFirst({ where: { runbookId: run.runbookId, version: run.version } });
      return { run, target, steps, version };
    });
    if (!loaded?.version) return; // the run was deleted: nothing to do
    const { run, target, steps, version } = loaded;
    if (target.status !== 'queued' && target.status !== 'running') return; // already settled (a duplicate delivery)

    const settle = async (status: 'succeeded' | 'failed' | 'cancelled' | 'waiting', code?: FailureCode, message?: string) => {
      await this.settle(job, orgId, payload.runId, payload.targetId, status, code, message);
      this.metrics.targetDuration((Date.now() - startedAt) / 1000, status);
    };

    // 1. A cancel that arrived before the job did.
    if (['cancelling', 'cancelled'].includes(run.status) || target.cancelRequestedAt) return settle('cancelled', FAILURE_CODES.CANCELLED);

    // 2. The initiator, as they are now.
    const initiator = run.initiatedBy ? await this.access.load(run.initiatedBy, orgId) : null;
    if (!initiator || !this.access.canRun(initiator)) return settle('failed', FAILURE_CODES.PERMISSION_REVOKED, 'The person who started this run can no longer run runbooks');

    if (!target.serverProfileId) return settle('failed', FAILURE_CODES.PERMISSION_REVOKED, 'The server profile no longer exists');
    let profile;
    try {
      profile = await this.access.decryptProfile(initiator, target.serverProfileId);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 403 || status === 404) return settle('failed', FAILURE_CODES.PERMISSION_REVOKED, 'The server is no longer available to the person who started this run');
      this.logger.warn(`profile not decrypted: ${errorName(error)}`);
      return settle('failed', FAILURE_CODES.INTERNAL, 'The server credential could not be read');
    }

    // 3. Secrets (memory only) and settings.
    const secrets: Record<string, string> = {};
    for (const [param, name] of Object.entries((run.secretRefs ?? {}) as Record<string, string>)) {
      const value = await this.credentials.getSecret(orgId, RUNBOOK_SECRET_PURPOSE, name).catch(() => null);
      if (value === null || value === undefined) return settle('failed', FAILURE_CODES.SECRET_UNAVAILABLE, `A secret this run needs is not available (${param})`);
      secrets[param] = value;
    }
    const effective = await this.settings.effective(orgId);

    // 4. Mark running, then connect.
    await this.inOrg(orgId, async (tx) => {
      if (target.status === 'queued') assertTransition('target', 'queued', 'running');
      await tx.runbookRunTarget.update({
        where: { id: payload.targetId },
        data: { status: 'running', startedAt: target.startedAt ?? new Date() },
      });
    });
    await this.events.publish({ type: 'target', runId: payload.runId, targetId: payload.targetId, status: 'running' });

    let client: Client;
    try {
      client = await this.factory.open(profile, { purpose: 'exec' });
    } catch (error) {
      if (!(error instanceof HostKeyError)) this.logger.warn(`ssh connect failed: ${errorName(error)}`);
      return settle('failed', connectFailureCode(error), 'The server could not be reached');
    }

    const watch = new CancelWatch(this.prisma, this.events, orgId, payload.runId, payload.targetId).start();
    let final: { status: 'succeeded' | 'failed' | 'cancelled' | 'waiting'; code?: FailureCode } = { status: 'failed', code: FAILURE_CODES.INTERNAL };
    try {
      const segment: Segment = {
        job,
        orgId,
        runId: payload.runId,
        targetId: payload.targetId,
        definition: version.definition as unknown as RunbookDefinition,
        initiator,
        params: stringifyParams(run.params),
        secrets,
        maxLogBytes: effective.maxLogBytesPerStep,
        allowSelfApproval: effective.approvals.allowSelfApproval,
        target: { serverProfileId: target.serverProfileId },
        client,
        watch,
        facts: readStoredFacts(await this.factsOf(orgId, target.serverProfileId)),
        profileId: profile.id,
        rows: new Map(steps.map((s) => [s.stepIndex, { id: s.id, status: s.status }])),
      };
      final = await this.runSteps(segment, payload.fromStepIndex);
    } catch (error) {
      this.logger.error(`segment failed: ${errorName(error)}`);
      final = { status: 'failed', code: FAILURE_CODES.INTERNAL };
    } finally {
      watch.stop();
      try {
        client.end();
        client.destroy();
      } catch {
        // already closed
      }
    }
    await settle(final.status, final.code);
  }

  private async factsOf(orgId: string, serverProfileId: string): Promise<unknown> {
    // Server profiles are user-owned (no row-level security); the profile was already authorised above.
    const row = await this.prisma.serverProfile.findFirst({ where: { id: serverProfileId, orgId }, select: { facts: true } });
    return row?.facts ?? null;
  }

  // ---------------------------------------------------------------------------
  // The steps
  // ---------------------------------------------------------------------------

  private async runSteps(seg: Segment, fromStepIndex: number): Promise<{ status: 'succeeded' | 'failed' | 'cancelled' | 'waiting'; code?: FailureCode }> {
    const steps = seg.definition.steps;
    // A failure BEFORE this segment (a parked-then-resumed target) still decides `on_success` / `on_failure`.
    let failed: FailureCode | null = null;
    for (let i = 0; i < fromStepIndex; i += 1) {
      const row = seg.rows.get(i);
      if (row && (row.status === 'failed' || row.status === 'timed_out') && !steps[i]!.continueOnError) failed = FAILURE_CODES.STEP_FAILED;
    }
    let cancelled = false;

    for (let i = fromStepIndex; i < steps.length; i += 1) {
      const step = steps[i]!;
      const row = seg.rows.get(i);
      if (!row) throw new Error('step row missing');

      if (seg.watch.signal.aborted) {
        cancelled = true;
        break;
      }
      const runs = step.when === 'always' || (step.when === 'on_success' && failed === null) || (step.when === 'on_failure' && failed !== null);
      if (!runs) {
        await this.setStep(seg, i, row.id, 'pending', 'skipped');
        continue;
      }

      const outcome = await this.runStep(seg, i, step, row.id);
      if (outcome.status === 'waiting_approval') return { status: 'waiting' };
      if (outcome.status === 'cancelled') {
        cancelled = true;
        break;
      }
      if ((outcome.status === 'failed' || outcome.status === 'timed_out') && !step.continueOnError && failed === null) {
        failed = outcome.code ?? FAILURE_CODES.STEP_FAILED;
      }
    }
    if (cancelled) return { status: 'cancelled', code: FAILURE_CODES.CANCELLED };
    return failed === null ? { status: 'succeeded' } : { status: 'failed', code: failed };
  }

  private async setStep(
    seg: Segment,
    index: number,
    rowId: string,
    from: string,
    to: string,
    extra: { exitCode?: number | null; durationMs?: number | null; errorCode?: string | null; startedAt?: Date; finished?: boolean } = {},
  ): Promise<void> {
    assertTransition('step', from, to);
    const now = new Date();
    await this.inOrg(seg.orgId, (tx) =>
      tx.runbookRunStep.update({
        where: { id: rowId },
        data: {
          status: to,
          ...(extra.exitCode !== undefined ? { exitCode: extra.exitCode } : {}),
          ...(extra.durationMs !== undefined ? { durationMs: extra.durationMs } : {}),
          ...(extra.errorCode !== undefined ? { errorCode: extra.errorCode } : {}),
          ...(extra.startedAt ? { startedAt: extra.startedAt } : {}),
          ...(extra.finished || ['skipped', 'succeeded', 'failed', 'timed_out', 'cancelled'].includes(to) ? { finishedAt: now } : {}),
        },
      }),
    );
    seg.rows.set(index, { id: rowId, status: to });
    await this.events.publish({
      type: 'step',
      runId: seg.runId,
      targetId: seg.targetId,
      stepIndex: index,
      status: to,
      exitCode: extra.exitCode ?? null,
      durationMs: extra.durationMs ?? null,
    });
  }

  private async runStep(seg: Segment, index: number, step: RunbookStep, rowId: string): Promise<StepOutcome> {
    switch (step.kind) {
      case 'command':
        return this.runScript(seg, index, step, rowId, {
          script: step.command,
          interpreter: 'bash',
          strict: true,
          workdir: step.workdir,
          runAs: step.runAs,
          successExitCodes: step.successExitCodes,
        });
      case 'script':
        return this.runScript(seg, index, step, rowId, {
          script: step.body,
          interpreter: step.interpreter,
          strict: step.interpreter === 'bash',
          args: step.args,
          workdir: step.workdir,
          runAs: step.runAs,
          successExitCodes: step.successExitCodes,
        });
      case 'package_update': {
        const rendered = renderPackageUpdate(step, seg.facts?.packageManager);
        if (!rendered.ok) return this.failStep(seg, index, rowId, rendered.code, rendered.message);
        return this.runScript(seg, index, step, rowId, {
          script: rendered.script,
          interpreter: 'bash',
          strict: true,
          runAs: step.runAs,
          successExitCodes: [0],
        });
      }
      case 'file_upload':
        return this.runFileUpload(seg, index, step, rowId);
      case 'approval_gate':
        return this.runApprovalGate(seg, index, step, rowId);
      case 'collect_logs':
      case 'ai_task':
        return this.failStep(seg, index, rowId, FAILURE_CODES.STEP_KIND_NOT_AVAILABLE, `${step.kind} steps are not available yet`);
    }
  }

  /** A step that cannot run: started and failed at once, with one system line saying why. */
  private async failStep(seg: Segment, index: number, rowId: string, code: FailureCode, message: string): Promise<StepOutcome> {
    const started = new Date();
    await this.setStep(seg, index, rowId, 'pending', 'running', { startedAt: started });
    const sink = this.sinkFor(seg, index, rowId);
    sink.system(`${message}\n`);
    await sink.close();
    await this.finishStep(seg, index, rowId, sink, 'running', 'failed', { code, durationMs: 0, exitCode: null });
    return { status: 'failed', code };
  }

  private sinkFor(seg: Segment, index: number, rowId: string): LogSink {
    return new LogSink({
      runId: seg.runId,
      targetId: seg.targetId,
      stepIndex: index,
      runStepId: rowId,
      secrets: Object.values(seg.secrets),
      maxBytes: seg.maxLogBytes,
      ports: {
        insertChunk: (chunk) =>
          this.inOrg(seg.orgId, async (tx) => {
            await tx.runbookRunLogChunk.create({
              data: { orgId: seg.orgId, runId: seg.runId, runStepId: chunk.runStepId, seq: chunk.seq, stream: chunk.stream, data: chunk.data, bytes: chunk.bytes },
            });
          }),
        publish: (event) => this.events.publish(event),
      },
    });
  }

  private async finishStep(
    seg: Segment,
    index: number,
    rowId: string,
    sink: LogSink,
    from: string,
    to: StepStatus,
    result: { code?: FailureCode; exitCode: number | null; durationMs: number },
  ): Promise<void> {
    assertTransition('step', from, to);
    await this.inOrg(seg.orgId, (tx) =>
      tx.runbookRunStep.update({
        where: { id: rowId },
        data: {
          status: to,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          errorCode: result.code ?? null,
          outputTail: sink.outputTail() || null,
          logBytes: sink.bytes,
          logTruncated: sink.truncated,
          finishedAt: new Date(),
        },
      }),
    );
    seg.rows.set(index, { id: rowId, status: to });
    await this.archive.archiveStep(seg.orgId, rowId);
    await this.events.publish({
      type: 'step',
      runId: seg.runId,
      targetId: seg.targetId,
      stepIndex: index,
      status: to,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });
  }

  /** The audit row of one command: hash and redacted preview, never the raw text. */
  private async recordExecution(seg: Segment, rowId: string, script: string): Promise<string> {
    const literals = Object.values(seg.secrets).filter((s) => s.length > 0);
    const clipped = splitUtf8(script, COMMAND_PREVIEW_BYTES)[0] ?? '';
    const preview = redactText(clipped, { extraLiterals: literals }).text;
    return this.inOrg(seg.orgId, async (tx) => {
      const row = await tx.runbookCommandExecution.create({
        data: {
          orgId: seg.orgId,
          serverProfileId: seg.profileId,
          runStepId: null,
          origin: 'step',
          commandSha256: sha256Hex(script),
          commandPreview: preview,
        },
        select: { id: true },
      });
      return row.id;
    });
  }

  private async finishExecution(seg: Segment, id: string, rowId: string, r: { exitCode: number | null; signal: string | null; timedOut: boolean; bytes: number }) {
    await this.inOrg(seg.orgId, (tx) =>
      tx.runbookCommandExecution.update({
        where: { id },
        data: { runStepId: rowId, exitCode: r.exitCode, signal: r.signal, timedOut: r.timedOut, bytes: r.bytes, finishedAt: new Date() },
      }),
    );
  }

  private async runScript(
    seg: Segment,
    index: number,
    step: RunbookStep,
    rowId: string,
    spec: {
      script: string;
      interpreter: 'bash' | 'sh' | 'python3';
      strict: boolean;
      args?: readonly string[];
      workdir?: string | undefined;
      runAs?: { sudo?: boolean; user?: string | undefined } | undefined;
      successExitCodes: readonly number[];
    },
  ): Promise<StepOutcome> {
    const started = Date.now();
    await this.setStep(seg, index, rowId, 'pending', 'running', { startedAt: new Date(started) });
    const sink = this.sinkFor(seg, index, rowId);
    const executionId = await this.recordExecution(seg, rowId, spec.script);

    const request: SshExecRequest = {
      script: spec.script,
      interpreter: spec.interpreter,
      strict: spec.strict,
      env: seg.params,
      secrets: seg.secrets,
      ...(spec.args ? { args: spec.args } : {}),
      ...(spec.workdir ? { workdir: spec.workdir } : {}),
      ...(spec.runAs ? { runAs: { sudo: spec.runAs.sudo ?? false, ...(spec.runAs.user ? { user: spec.runAs.user } : {}) } } : {}),
      timeoutSec: step.timeoutSec,
      signal: seg.watch.signal,
      onChunk: (chunk) => sink.push(chunk.stream, chunk.data),
      span: { stepKind: step.kind, stepIndex: index, serverProfileId: seg.profileId },
    };

    let status: StepStatus;
    let code: FailureCode | undefined;
    let exitCode: number | null = null;
    try {
      const result = await this.executor.exec(seg.client, request);
      exitCode = result.exitCode;
      await sink.close();
      await this.finishExecution(seg, executionId, rowId, result);
      if (result.aborted) {
        status = 'cancelled';
        code = FAILURE_CODES.CANCELLED;
      } else if (result.timedOut) {
        status = 'timed_out';
        code = FAILURE_CODES.STEP_TIMED_OUT;
      } else if (result.sudoPasswordRequired) {
        status = 'failed';
        code = FAILURE_CODES.SUDO_PASSWORD_REQUIRED;
      } else if (result.exitCode !== null && spec.successExitCodes.includes(result.exitCode)) {
        status = 'succeeded';
      } else {
        status = 'failed';
        code = FAILURE_CODES.STEP_FAILED;
      }
    } catch (error) {
      this.logger.warn(`exec failed: ${errorName(error)}`);
      await sink.close();
      status = 'failed';
      code = FAILURE_CODES.SSH_UNREACHABLE;
    }
    this.metrics.command('step', status === 'succeeded' ? 'succeeded' : status === 'timed_out' ? 'timed_out' : status === 'cancelled' ? 'cancelled' : 'failed');
    await this.finishStep(seg, index, rowId, sink, 'running', status, { ...(code ? { code } : {}), exitCode, durationMs: Date.now() - started });
    return { status, ...(code ? { code } : {}) };
  }

  // ---------------------------------------------------------------------------
  // file_upload
  // ---------------------------------------------------------------------------

  /** A short command with its output collected locally (the checks around an upload). */
  private async quietExec(seg: Segment, rowId: string, script: string, runAs: { sudo?: boolean; user?: string | undefined } | undefined): Promise<{ exitCode: number | null; stdout: string }> {
    const executionId = await this.recordExecution(seg, rowId, script);
    let stdout = '';
    const result = await this.executor.exec(seg.client, {
      script,
      interpreter: 'bash',
      strict: true,
      timeoutSec: 600,
      signal: seg.watch.signal,
      ...(runAs ? { runAs: { sudo: runAs.sudo ?? false, ...(runAs.user ? { user: runAs.user } : {}) } } : {}),
      onChunk: (c) => {
        if (c.stream === 'stdout' && stdout.length < 4096) stdout += c.data.toString('utf8');
      },
    });
    await this.finishExecution(seg, executionId, rowId, result);
    this.metrics.command('step', result.exitCode === 0 ? 'succeeded' : 'failed');
    return { exitCode: result.exitCode, stdout };
  }

  private sftp(client: Client): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp))));
  }

  private async runFileUpload(seg: Segment, index: number, step: Extract<RunbookStep, { kind: 'file_upload' }>, rowId: string): Promise<StepOutcome> {
    const started = Date.now();
    await this.setStep(seg, index, rowId, 'pending', 'running', { startedAt: new Date(started) });
    const sink = this.sinkFor(seg, index, rowId);
    const finish = async (status: StepStatus, code?: FailureCode, line?: string): Promise<StepOutcome> => {
      if (line) sink.system(`${line}\n`);
      await sink.close();
      await this.finishStep(seg, index, rowId, sink, 'running', status, { ...(code ? { code } : {}), exitCode: status === 'succeeded' ? 0 : null, durationMs: Date.now() - started });
      return { status, ...(code ? { code } : {}) };
    };

    const temp = `${step.destPath}.shellkeep-tmp`;
    let source: Awaited<ReturnType<RunFileSource['open']>>;
    try {
      source = await this.files.open(seg.orgId, seg.initiator.scope.userId, step.storageObjectId, MAX_UPLOAD_BYTES);
    } catch (error) {
      if (error instanceof RunFileError) return finish('failed', error.code === 'FILE_TOO_LARGE' ? FAILURE_CODES.FILE_TOO_LARGE : FAILURE_CODES.FORBIDDEN, error.message);
      return finish('failed', FAILURE_CODES.INTERNAL, 'The file could not be read');
    }

    try {
      if (!step.overwrite) {
        const exists = await this.quietExec(seg, rowId, `test -e ${shellQuote(step.destPath)}`, step.runAs);
        if (exists.exitCode === 0) {
          source.stream.destroy();
          return finish('failed', FAILURE_CODES.DEST_EXISTS, 'The destination file already exists');
        }
      }
      const hash = createHash('sha256');
      const sftp = await this.sftp(seg.client);
      await new Promise<void>((resolve, reject) => {
        const out = sftp.createWriteStream(temp, { mode: 0o600 });
        const input: Readable = source.stream;
        input.on('data', (part: Buffer) => hash.update(part));
        input.on('error', reject);
        out.on('error', reject);
        out.on('close', () => resolve());
        seg.watch.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        input.pipe(out);
      });
      sftp.end();
      const expected = hash.digest('hex');

      const remote = await this.quietExec(seg, rowId, `sha256sum -- ${shellQuote(temp)}`, step.runAs);
      const actual = remote.stdout.trim().split(/\s+/)[0] ?? '';
      if (remote.exitCode !== 0 || actual !== expected) {
        await this.quietExec(seg, rowId, `rm -f -- ${shellQuote(temp)}`, step.runAs).catch(() => undefined);
        return finish('failed', FAILURE_CODES.UPLOAD_CHECKSUM_MISMATCH, 'The uploaded file did not match its checksum');
      }
      const mode = step.mode.length === 3 ? `0${step.mode}` : step.mode;
      const lines = [`chmod ${mode} -- ${shellQuote(temp)}`];
      if (step.owner) lines.push(`chown ${shellQuote(step.owner)} -- ${shellQuote(temp)}`);
      lines.push(step.overwrite ? `mv -f -- ${shellQuote(temp)} ${shellQuote(step.destPath)}` : `mv -n -- ${shellQuote(temp)} ${shellQuote(step.destPath)}`);
      const done = await this.quietExec(seg, rowId, lines.join('\n'), step.runAs);
      if (done.exitCode !== 0) return finish('failed', FAILURE_CODES.STEP_FAILED, 'The file could not be put in place');
      return finish('succeeded', undefined, `Uploaded ${source.size} bytes`);
    } catch (error) {
      if (seg.watch.signal.aborted) return finish('cancelled', FAILURE_CODES.CANCELLED, 'Cancelled');
      this.logger.warn(`upload failed: ${errorName(error)}`);
      return finish('failed', FAILURE_CODES.STEP_FAILED, 'The upload failed');
    }
  }

  // ---------------------------------------------------------------------------
  // approval_gate
  // ---------------------------------------------------------------------------

  private async runApprovalGate(seg: Segment, index: number, step: Extract<RunbookStep, { kind: 'approval_gate' }>, rowId: string): Promise<StepOutcome> {
    const now = new Date();
    const scopeKey = step.scope === 'run' ? 'run' : seg.targetId;
    await this.setStep(seg, index, rowId, 'pending', 'running', { startedAt: now });

    const gate = await this.inOrg(seg.orgId, async (tx) => {
      const created = await tx.runbookApproval.createMany({
        data: [
          {
            orgId: seg.orgId,
            runId: seg.runId,
            runTargetId: step.scope === 'target' ? seg.targetId : null,
            scopeKey,
            scope: step.scope,
            kind: 'step',
            stepIndex: index,
            stepName: step.name,
            message: step.message,
            expiresAt: new Date(now.getTime() + step.expiresAfterSec * 1000),
          },
        ],
        skipDuplicates: true,
      });
      const approval = await tx.runbookApproval.findUniqueOrThrow({
        where: { runId_stepIndex_scopeKey: { runId: seg.runId, stepIndex: index, scopeKey } },
      });
      const run = await tx.runbookRun.findUniqueOrThrow({ where: { id: seg.runId }, select: { runbookId: true, version: true } });
      const targetsTotal = await tx.runbookRunTarget.count({ where: { runId: seg.runId } });
      return { approval, created: created.count > 0, run, targetsTotal };
    });

    if (gate.approval.status === 'approved') {
      await this.setStep(seg, index, rowId, 'running', 'succeeded', { durationMs: 0, exitCode: null });
      return { status: 'succeeded' };
    }
    if (gate.approval.status === 'rejected' || gate.approval.status === 'expired') {
      const code = gate.approval.status === 'rejected' ? FAILURE_CODES.APPROVAL_REJECTED : FAILURE_CODES.APPROVAL_EXPIRED;
      await this.setStep(seg, index, rowId, 'running', 'failed', { durationMs: 0, errorCode: code });
      return { status: 'failed', code };
    }

    // Pending: park the target on this step.
    await this.setStep(seg, index, rowId, 'running', 'waiting_approval');
    await this.events.publish({ type: 'approval', runId: seg.runId, approvalId: gate.approval.id, status: 'pending', scope: step.scope, kind: 'step' });
    if (gate.created) {
      await this.lifecycle.notifyApprovers({
        approvalId: gate.approval.id,
        runId: seg.runId,
        orgId: seg.orgId,
        runbookId: gate.run.runbookId,
        version: gate.run.version,
        stepName: step.name,
        targetsTotal: gate.targetsTotal,
        kind: 'step',
      });
    }
    return { status: 'waiting_approval' };
  }

  // ---------------------------------------------------------------------------
  // Settling
  // ---------------------------------------------------------------------------

  /** Settles the target and advances the run in ONE transaction; publishes after the commit. */
  private async settle(
    job: Job,
    orgId: string,
    runId: string,
    targetId: string,
    status: 'succeeded' | 'failed' | 'cancelled' | 'waiting',
    code?: FailureCode,
    message?: string,
  ): Promise<void> {
    const now = new Date();
    const outcome = await this.jobScope.run<Awaited<ReturnType<RunCoordinatorService['advance']>>, OrgTx>(job, async (tx) => {
      const target = await tx.runbookRunTarget.findUnique({ where: { id: targetId }, select: { status: true } });
      if (!target) return this.coordinator.advance(tx, runId, now);
      if (status === 'waiting') {
        if (target.status === 'running') {
          assertTransition('target', 'running', 'waiting');
          await tx.runbookRunTarget.update({ where: { id: targetId }, data: { status: 'waiting' } });
        }
      } else if (target.status !== 'succeeded' && target.status !== 'failed' && target.status !== 'cancelled' && target.status !== 'skipped') {
        assertTransition('target', target.status, status);
        await tx.runbookRunTarget.update({
          where: { id: targetId },
          data: { status, errorCode: code ?? null, errorMessage: message ? message.slice(0, 500) : null, finishedAt: now },
        });
        // Steps that never ran leave the matrix as skipped (or cancelled).
        await tx.runbookRunStep.updateMany({
          where: { runTargetId: targetId, status: 'pending' },
          data: { status: status === 'cancelled' ? 'cancelled' : 'skipped', finishedAt: now },
        });
      }
      return this.coordinator.advance(tx, runId, now);
    });
    outcome.events.unshift({ type: 'target', runId, targetId, status, errorCode: code ?? null });
    await this.lifecycle.afterCommit(outcome);
    void orgId;
  }
}

function stringifyParams(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === 'object') {
    for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
      if (raw === null || raw === undefined) continue;
      out[name] = typeof raw === 'string' ? raw : String(raw);
    }
  }
  return out;
}
