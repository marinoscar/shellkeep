// =============================================================================
// `ai.runbook.agent` (issue #64): the AI step of a runbook
// =============================================================================
//
// Runs ONE `ai_task` step on ONE target. `runbook.target.run` parks the target `waiting` on the step (the step
// is `running`) and enqueues this job (`phase: 'start'`); an approval decision enqueues it again
// (`phase: 'resume'`). When the step ends, this job queues `runbook.target.run` for the step after it, and the
// coordinator carries on as after any other step.
//
// SERVER-ONLY, permanently: it carries NEITHER `nodeResultSchema` NOR `persistNodeResult` (AI rule 3). It
// spends the initiator's own AI key and holds the server credential and the run's secrets; no worker node
// may hold either. `maxAttempts: 1`: a retry would run commands twice. The type string is permanent
// (`test/jobs/job-type-snapshot.spec.ts`).
//
// PRE-CHECKS, in order, each ending the step with its own code before any provider call or SSH connection:
//   AI off for the organization (`AI_DISABLED`), `runbooks.ai.agentEnabled` (`RUNBOOK_AI_DISABLED`), the
//   server's `aiOutputSharing` (`AI_OUTPUT_SHARING_DISABLED`: an agent cannot work blind), and the initiator
//   still holding `runbooks:run` and `ai:use` (`PERMISSION_REVOKED`).
//
// SAFETY, in order, none of it optional (the policy is `agent-policy.ts`, the loops are `agent-loops.ts`):
//   * the payload carries ids only; a secret value lives only in this process's memory;
//   * every command passes the policy first; in `per_command` mode no command runs without an `approved`
//     approval row, in `autonomous_within_allowlist` mode none runs that fails the allow list, matches the
//     deny list or is destructive;
//   * everything the model sees of a command is stripped, redacted with the run's secret literals and cut;
//   * every command, run or refused, is a `runbook_command_executions` row with `origin: 'ai_agent'`.
//
// FAILURE. A provider throttle with no command run in this attempt is `throw err.toRateLimitError()` (the
// queue defers the job); with a command already run it fails the step, because a retry would repeat it.
// =============================================================================

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { AiConfigService, AiError, AiService } from '@marinoscar/platform-api/ai';
import { AUDIT_SINK, runInOrg, type AuditSink } from '@marinoscar/platform-api/core';
import { OrgCredentialsService } from '@marinoscar/platform-api/credentials';
import { JobHandlerRegistry, JobScope, JobsService, type Job, type JobHandler, type JobsTx } from '@marinoscar/platform-api/jobs';
import { Prisma } from '@prisma/client';

import { PERMISSIONS } from '../../common/constants/roles.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { HostKeyError } from '../../ssh/host-key.error';
import { SshConnectionFactory } from '../../ssh/ssh-connection.factory';
import { readStoredFacts } from '../../ssh/server-facts.service';
import { EngineAccessService, type Initiator } from '../engine/engine-access.service';
import { EngineMetricsService } from '../engine/engine-metrics.service';
import { CancelWatch } from '../engine/cancel-watch';
import { FAILURE_CODES, RUNBOOK_JOB_REASON, RUNBOOK_RUN_TARGET_SUBJECT, RUNBOOK_TARGET_RUN_TYPE } from '../engine/engine.constants';
import { LogArchiveService } from '../engine/log-archive.service';
import type { LogSink } from '../engine/log-sink';
import type { OrgTx } from '../engine/run-coordinator.service';
import { RunEventsService } from '../engine/run-events.service';
import { RunLifecycleService } from '../engine/run-lifecycle.service';
import { RunbookSettingsService } from '../engine/runbook-settings.service';
import { SshExecutor } from '../engine/ssh-executor';
import { assertTransition } from '../engine/state-machine';
import { connectFailureCode } from '../engine/target-run.handler';
import { RUNBOOK_SECRET_PURPOSE } from '../runbooks.credentials';
import type { RunbookDefinition } from '../schema/runbook-definition.schema';
import { redactForStorage } from './agent-output';
import {
  executePlan,
  instructionsFor,
  newLoopState,
  runAutonomous,
  runPerCommand,
  startPlan,
  type AgentOutcome,
  type Decision,
  type LoopContext,
} from './agent-loops';
import { AgentEnd, AgentSession, makeSink, type AiTaskStep, type SessionInit } from './agent-session';
import { agentStateSchema, type AgentState } from './agent-transcript';
import {
  agentPayloadSchema,
  AI_FAILURE_CODES,
  MAX_SUMMARY_CHARS,
  RUNBOOK_AGENT_FEATURE,
  RUNBOOK_AGENT_TYPE,
  type AgentPayload,
} from './runbook-agent.constants';

/** AI errors no retry can fix: the step fails now with the platform's own code. */
const TERMINAL_AI_CODES: ReadonlySet<string> = new Set([
  'AI_DISABLED',
  'AI_PROVIDER_DISABLED',
  'AI_KEY_REQUIRED',
  'AI_KEY_INVALID',
  'AI_MODEL_NOT_ENABLED',
  'AI_MODEL_NOT_REACHABLE',
  'AI_CAPABILITY_UNSUPPORTED',
  'AI_INVALID_REQUEST',
  'AI_CONTENT_FILTERED',
  'AI_STRUCTURED_OUTPUT_INVALID',
  'AI_RATE_LIMITED',
]);

/** How long the job waits for the launching `runbook.target.run` job to settle before it queues the next segment. */
const LAUNCH_SETTLE_WAIT_MS = 60_000;
const LAUNCH_SETTLE_POLL_MS = 250;

type StepEnd = { status: 'succeeded' | 'failed' | 'cancelled'; code?: string; summary?: string };

interface Loaded {
  payload: AgentPayload;
  orgId: string;
  run: { id: string; runbookId: string; version: number; initiatedBy: string | null; secretRefs: unknown; params: unknown };
  target: { id: string; serverProfileId: string | null };
  stepRow: { id: string; startedAt: Date | null; aiTranscript: unknown };
  step: AiTaskStep;
  definition: RunbookDefinition;
}

@Injectable()
export class RunbookAgentHandler implements JobHandler, OnModuleInit {
  readonly type = RUNBOOK_AGENT_TYPE;
  readonly label = 'Run an AI step of a runbook';
  // 30 minutes of working time; approval waits do not count (the job ends while a person decides). One attempt.
  readonly profile = { maxRuntimeMs: 30 * 60_000, maxAttempts: 1 } as const;

  private readonly logger = new Logger(RunbookAgentHandler.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly prisma: PrismaService,
    private readonly jobScope: JobScope,
    private readonly jobs: JobsService,
    private readonly access: EngineAccessService,
    private readonly factory: SshConnectionFactory,
    private readonly executor: SshExecutor,
    private readonly archive: LogArchiveService,
    private readonly events: RunEventsService,
    private readonly settings: RunbookSettingsService,
    private readonly credentials: OrgCredentialsService,
    private readonly metrics: EngineMetricsService,
    private readonly ai: AiService,
    private readonly aiConfig: AiConfigService,
    private readonly lifecycle: RunLifecycleService,
    @Inject(AUDIT_SINK) private readonly auditSink: AuditSink,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  private inOrg<T>(orgId: string, fn: (tx: OrgTx) => Promise<T>): Promise<T> {
    return runInOrg(this.prisma, { orgId }, fn);
  }

  async process(job: Job): Promise<void> {
    const parsed = agentPayloadSchema.safeParse(job.payload);
    if (!parsed.success) {
      throw new Error(`Invalid ${RUNBOOK_AGENT_TYPE} payload: expected { runId, targetId, stepIndex, orgId, phase }`);
    }
    const payload = parsed.data;
    if (!job.orgId || job.orgId !== payload.orgId) throw new Error(`${RUNBOOK_AGENT_TYPE} needs the organization of its payload`);

    const loaded = await this.load(payload);
    if (!loaded) return;
    const { orgId } = loaded;

    // ---- pre-checks: each ends the step before any provider call or SSH connection -----------------------------
    const early = await this.precheck(loaded);
    const initiator = early.initiator;
    if (early.fail || !initiator) {
      const code = early.fail?.code ?? FAILURE_CODES.PERMISSION_REVOKED;
      await this.failBeforeStart(job, loaded, code, early.fail?.message ?? 'The step could not start');
      return;
    }
    const profileId = loaded.target.serverProfileId!;

    // ---- the session --------------------------------------------------------------------------------------------
    let profile;
    try {
      profile = await this.access.decryptProfile(initiator, profileId);
    } catch (error) {
      const status = (error as { status?: number }).status;
      const code = status === 403 || status === 404 ? FAILURE_CODES.PERMISSION_REVOKED : FAILURE_CODES.INTERNAL;
      await this.failBeforeStart(job, loaded, code, 'The server is no longer available to the person who started this run');
      return;
    }
    const secrets: Record<string, string> = {};
    for (const [param, name] of Object.entries((loaded.run.secretRefs ?? {}) as Record<string, string>)) {
      const value = await this.credentials.getSecret(orgId, RUNBOOK_SECRET_PURPOSE, name).catch(() => null);
      if (value === null || value === undefined) {
        await this.failBeforeStart(job, loaded, FAILURE_CODES.SECRET_UNAVAILABLE, `A secret this run needs is not available (${param})`);
        return;
      }
      secrets[param] = value;
    }
    const effective = await this.settings.effective(orgId);

    const stored = await this.readStored(loaded);
    const progress = await this.inOrg(orgId, (tx) =>
      tx.runbookRunLogChunk.aggregate({ where: { runStepId: loaded.stepRow.id }, _max: { seq: true }, _sum: { bytes: true } }),
    );

    const watch = new CancelWatch(this.prisma, this.events, orgId, payload.runId, payload.targetId).start();
    const init: SessionInit = {
      orgId,
      runId: payload.runId,
      targetId: payload.targetId,
      stepIndex: payload.stepIndex,
      stepRowId: loaded.stepRow.id,
      step: loaded.step,
      initiatorUserId: initiator.scope.userId,
      params: stringifyParams(loaded.run.params),
      secrets,
      profileId: profile.id,
      connect: async () => {
        try {
          return await this.factory.open(profile, { purpose: 'exec' });
        } catch (error) {
          if (!(error instanceof HostKeyError)) this.logger.warn(`ssh connect failed: ${error instanceof Error ? error.name : 'error'}`);
          throw new AgentEnd(connectFailureCode(error));
        }
      },
      cancelSignal: watch.signal,
      refusals: stored?.kind === 'loop' ? stored.refusals : 0,
      startSeq: (progress._max.seq ?? -1) + 1,
      startBytes: progress._sum.bytes ?? 0,
      maxLogBytes: effective.maxLogBytesPerStep,
    };
    const session = new AgentSession(
      { prisma: this.prisma, executor: this.executor, events: this.events, metrics: this.metrics, auditSink: this.auditSink, logger: this.logger },
      init,
    ).start();

    try {
      let end: StepEnd;
      let paused: Extract<AgentOutcome, { kind: 'paused' }> | null = null;
      try {
        const outcome = await this.drive(loaded, session, initiator, stored);
        if (outcome === null) return; // a stale resume: nothing to do
        if (outcome.kind === 'paused') {
          paused = outcome;
          end = { status: 'succeeded' };
        } else if (outcome.kind === 'failed') {
          session.note(outcome.message);
          end = { status: 'failed', code: outcome.code };
        } else if (outcome.failed) {
          end = { status: 'failed', code: FAILURE_CODES.STEP_FAILED, summary: outcome.summary };
        } else {
          if (outcome.summary.trim() !== '') session.note(`summary: ${outcome.summary}`);
          end = { status: 'succeeded', summary: outcome.summary };
        }
      } catch (error) {
        end = this.endFor(error, session);
        session.note(`the step ended: ${end.code ?? end.status}`);
      }
      await session.sink.close();
      if (paused) await this.pause(job, loaded, session, paused, effective.approvals.defaultExpirySec);
      else await this.finishStep(job, loaded, session.sink, end);
    } finally {
      watch.stop();
      await session.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Loading and the pre-checks
  // ---------------------------------------------------------------------------

  private async load(payload: AgentPayload): Promise<Loaded | null> {
    const { orgId } = payload;
    const rows = await this.inOrg(orgId, async (tx) => {
      const [run, target, stepRow] = await Promise.all([
        tx.runbookRun.findUnique({ where: { id: payload.runId } }),
        tx.runbookRunTarget.findUnique({ where: { id: payload.targetId } }),
        tx.runbookRunStep.findUnique({ where: { runTargetId_stepIndex: { runTargetId: payload.targetId, stepIndex: payload.stepIndex } } }),
      ]);
      if (!run || !target || !stepRow) return null;
      const version = await tx.runbookVersion.findFirst({ where: { runbookId: run.runbookId, version: run.version } });
      return { run, target, stepRow, version };
    });
    if (!rows?.version) return null;
    const { run, target, stepRow } = rows;
    if (target.runId !== run.id || stepRow.runTargetId !== target.id) return null;
    // A cancelled or finished target, or a step that is no longer `running`: a duplicate or stale delivery.
    if (['cancelling', 'cancelled'].includes(run.status) || target.cancelRequestedAt) return null;
    if (target.status !== 'waiting' || stepRow.status !== 'running') return null;
    const definition = rows.version.definition as unknown as RunbookDefinition;
    const step = definition.steps[payload.stepIndex];
    if (!step || step.kind !== 'ai_task' || stepRow.kind !== 'ai_task') return null;
    return {
      payload,
      orgId,
      run,
      target: { id: target.id, serverProfileId: target.serverProfileId },
      stepRow: { id: stepRow.id, startedAt: stepRow.startedAt, aiTranscript: stepRow.aiTranscript },
      step,
      definition,
    };
  }

  private async precheck(loaded: Loaded): Promise<{ initiator: Initiator | null; fail?: { code: string; message: string } }> {
    const { orgId } = loaded;
    const initiator = loaded.run.initiatedBy ? await this.access.load(loaded.run.initiatedBy, orgId) : null;

    // The platform switch (deployment, then the organization's own).
    if (!(await this.aiConfig.resolveForOrg(orgId)).enabled) {
      return { initiator, fail: { code: AI_FAILURE_CODES.AI_DISABLED, message: 'AI is switched off, so this step cannot run' } };
    }
    if (!(await this.settings.effective(orgId)).ai.agentEnabled) {
      return { initiator, fail: { code: AI_FAILURE_CODES.RUNBOOK_AI_DISABLED, message: 'AI steps are switched off for runbooks (runbooks.ai.agentEnabled)' } };
    }
    if (!loaded.target.serverProfileId) {
      return { initiator, fail: { code: FAILURE_CODES.PERMISSION_REVOKED, message: 'The server profile no longer exists' } };
    }
    const profile = await this.prisma.serverProfile.findFirst({
      where: { id: loaded.target.serverProfileId, orgId },
      select: { aiOutputSharing: true },
    });
    if (!profile) return { initiator, fail: { code: FAILURE_CODES.PERMISSION_REVOKED, message: 'The server profile no longer exists' } };
    if (profile.aiOutputSharing === false) {
      return {
        initiator,
        fail: { code: AI_FAILURE_CODES.AI_OUTPUT_SHARING_DISABLED, message: 'This server does not share terminal output with AI, and an AI step cannot work blind' },
      };
    }
    if (!initiator || !this.access.canRun(initiator) || !initiator.principal.permissions.includes(PERMISSIONS.AI_USE)) {
      return { initiator, fail: { code: FAILURE_CODES.PERMISSION_REVOKED, message: 'The person who started this run can no longer run AI steps' } };
    }
    return { initiator };
  }

  private async readStored(loaded: Loaded): Promise<AgentState | null> {
    if (loaded.payload.phase !== 'resume') return null;
    const parsed = agentStateSchema.safeParse(loaded.stepRow.aiTranscript);
    return parsed.success ? parsed.data : null;
  }

  // ---------------------------------------------------------------------------
  // Driving the model
  // ---------------------------------------------------------------------------

  /** `null`: a resume with nothing to resume (the approval is not decided, or the stored conversation is gone). */
  private async drive(loaded: Loaded, session: AgentSession, initiator: Initiator, stored: AgentState | null): Promise<AgentOutcome | null> {
    const { step, orgId } = loaded;
    const profileFacts = await this.prisma.serverProfile.findFirst({ where: { id: loaded.target.serverProfileId!, orgId }, select: { facts: true } });
    const params = stringifyParams(loaded.run.params);
    const secretParams = new Set(loaded.definition.parameters.filter((p) => p.type === 'secret').map((p) => p.name));
    const plainParams = Object.fromEntries(Object.entries(params).filter(([name]) => !secretParams.has(name) && !(name in session.init.secrets)));
    const runAs = step.runAs;
    const runAsNote = runAs?.sudo ? `Commands run with sudo${runAs.user ? ` as ${runAs.user}` : ''}; do not prefix them with sudo.` : runAs?.user ? `Commands run as ${runAs.user}.` : null;

    const ctx: LoopContext = {
      session,
      client: this.ai.forUser(initiator.scope.userId, { orgId, feature: RUNBOOK_AGENT_FEATURE }),
      step,
      instructions: instructionsFor({
        goal: redactForStorage(step.goal, session.literals, 4000),
        mode: step.approvalMode,
        allow: step.allow,
        deny: step.deny,
        maxSteps: step.maxSteps,
        facts: readStoredFacts(profileFacts?.facts),
        params: plainParams,
        secretNames: [...secretParams, ...Object.keys(session.init.secrets)].filter((n, i, all) => all.indexOf(n) === i),
        tools: step.tools,
        commandTimeoutSec: step.commandTimeoutSec,
        runAsNote,
      }),
    };

    if (loaded.payload.phase === 'start') {
      session.note(`AI step started (${step.approvalMode})`);
      if (step.approvalMode === 'autonomous_within_allowlist') return runAutonomous(ctx);
      if (step.approvalMode === 'plan') return startPlan(ctx);
      return runPerCommand(ctx, newLoopState(), null);
    }

    // ---- resume --------------------------------------------------------------------------------------------------
    if (!stored) {
      this.logger.warn('an AI step resumed without its stored conversation');
      return { kind: 'failed', code: FAILURE_CODES.INTERNAL, message: 'The conversation of this step could not be restored' };
    }
    const approvalId = stored.kind === 'plan' ? stored.approvalId : stored.awaiting?.approvalId;
    if (!approvalId) return null;
    const approval = await this.inOrg(orgId, (tx) => tx.runbookApproval.findUnique({ where: { id: approvalId } }));
    // Only a DECIDED approval resumes; a pending one means a stale job, an expired one failed the step already.
    if (!approval || (approval.status !== 'approved' && approval.status !== 'rejected')) return null;

    if (stored.kind === 'plan') {
      if (approval.status !== 'approved') return null;
      session.note('plan approved');
      return executePlan(ctx, stored, approval.decidedBy);
    }
    const decision: Decision = {
      callId: stored.awaiting!.callId,
      status: approval.status as 'approved' | 'rejected',
      decidedBy: approval.decidedBy,
      comment: approval.comment,
    };
    session.note(`command ${decision.status}`);
    return runPerCommand(ctx, stored, decision);
  }

  /** The end of a step an error stopped. A throttle that cost nothing is rethrown so the queue defers the job. */
  private endFor(error: unknown, session: AgentSession): StepEnd {
    const reason = session.endReason ?? (error instanceof AgentEnd ? error.code : null);
    if (reason === 'CANCELLED') return { status: 'cancelled', code: FAILURE_CODES.CANCELLED };
    if (reason) return { status: 'failed', code: reason };
    if (error instanceof AiError) {
      const limited = error.toRateLimitError();
      if (limited && session.executed === 0) throw limited;
      return { status: 'failed', code: TERMINAL_AI_CODES.has(error.code) ? error.code : AI_FAILURE_CODES.AI_FAILED };
    }
    this.logger.error(`ai step failed: ${error instanceof Error ? error.name : 'error'}`);
    return { status: 'failed', code: FAILURE_CODES.INTERNAL };
  }

  // ---------------------------------------------------------------------------
  // Ending the job
  // ---------------------------------------------------------------------------

  /** A step that fails before it started: one log line saying why, then the usual end. */
  private async failBeforeStart(job: Job, loaded: Loaded, code: string, message: string): Promise<void> {
    const sink = makeSink(
      { prisma: this.prisma, events: this.events },
      { orgId: loaded.orgId, runId: loaded.payload.runId, targetId: loaded.payload.targetId, stepIndex: loaded.payload.stepIndex, stepRowId: loaded.stepRow.id, startSeq: await this.nextSeq(loaded), startBytes: 0, maxLogBytes: 1_048_576 },
      [],
    );
    sink.system(`[ai] ${message}\n`);
    await sink.close();
    await this.finishStep(job, loaded, sink, { status: 'failed', code });
  }

  private async nextSeq(loaded: Loaded): Promise<number> {
    const max = await this.inOrg(loaded.orgId, (tx) => tx.runbookRunLogChunk.aggregate({ where: { runStepId: loaded.stepRow.id }, _max: { seq: true } }));
    return (max._max.seq ?? -1) + 1;
  }

  /** The launching `runbook.target.run` job may still be marked running for a moment: queuing the next one would be deduplicated into it. */
  private async awaitLaunchSettled(targetId: string): Promise<void> {
    const until = Date.now() + LAUNCH_SETTLE_WAIT_MS;
    while (Date.now() < until) {
      const active = await this.prisma.job.findFirst({
        where: { type: RUNBOOK_TARGET_RUN_TYPE, subjectType: RUNBOOK_RUN_TARGET_SUBJECT, subjectId: targetId, status: { in: ['pending', 'running'] } },
        select: { id: true },
      });
      if (!active) return;
      await new Promise((resolve) => setTimeout(resolve, LAUNCH_SETTLE_POLL_MS));
    }
  }

  /**
   * Ends the step and hands the target back: the step row, the target `waiting -> queued` at the next step, and
   * the next `runbook.target.run`, in ONE transaction. A step that failed still hands back, so `always` and
   * `on_failure` steps after it run; the segment decides the target's final status from the rows.
   */
  private async finishStep(job: Job, loaded: Loaded, sink: LogSink, end: StepEnd): Promise<void> {
    const { orgId, payload } = loaded;
    if (end.status !== 'cancelled') await this.awaitLaunchSettled(payload.targetId);
    const now = new Date();
    const summary = end.summary ? redactForStorage(end.summary, [], MAX_SUMMARY_CHARS) : null;
    const events = await this.jobScope.run<Array<Parameters<RunEventsService['publishAll']>[0][number]>, OrgTx>(job, async (tx) => {
      const out: Array<Parameters<RunEventsService['publishAll']>[0][number]> = [];
      const moved = await tx.runbookRunStep.updateMany({
        where: { id: loaded.stepRow.id, status: { in: ['running', 'waiting_approval'] } },
        data: {
          status: end.status,
          errorCode: end.code ?? null,
          exitCode: null,
          durationMs: loaded.stepRow.startedAt ? now.getTime() - loaded.stepRow.startedAt.getTime() : null,
          outputTail: sink.outputTail() || null,
          logBytes: sink.bytes,
          logTruncated: sink.truncated,
          aiTranscript: Prisma.DbNull,
          aiSummary: summary,
          finishedAt: now,
        },
      });
      if (moved.count === 1) out.push({ type: 'step', runId: payload.runId, targetId: payload.targetId, stepIndex: payload.stepIndex, status: end.status, exitCode: null, durationMs: null });
      // A cancel already settled the parked target (and this step); only a still-waiting target is handed back.
      const target = await tx.runbookRunTarget.findUnique({ where: { id: payload.targetId }, select: { status: true } });
      if (moved.count === 1 && target?.status === 'waiting' && end.status !== 'cancelled') {
        assertTransition('target', 'waiting', 'queued');
        await tx.runbookRunTarget.update({ where: { id: payload.targetId }, data: { status: 'queued', nextStepIndex: payload.stepIndex + 1 } });
        await this.jobs.enqueueWithin(tx as unknown as JobsTx, {
          type: RUNBOOK_TARGET_RUN_TYPE,
          reason: RUNBOOK_JOB_REASON,
          orgId,
          subjectType: RUNBOOK_RUN_TARGET_SUBJECT,
          subjectId: payload.targetId,
          payload: { runId: payload.runId, targetId: payload.targetId, fromStepIndex: payload.stepIndex + 1 },
        });
        out.push({ type: 'target', runId: payload.runId, targetId: payload.targetId, status: 'queued' });
      }
      return out;
    });
    await this.archive.archiveStep(orgId, loaded.stepRow.id);
    await this.events.publishAll(events);
  }

  /** Stores the conversation and the approval it waits for; the step waits, the target stays parked. */
  private async pause(job: Job, loaded: Loaded, session: AgentSession, paused: Extract<AgentOutcome, { kind: 'paused' }>, expirySec: number): Promise<void> {
    const { orgId, payload, step } = loaded;
    const now = new Date();
    const draft = paused.approval;
    const created = await this.jobScope.run<{ runbookId: string; version: number; targetsTotal: number } | null, OrgTx>(job, async (tx) => {
      assertTransition('step', 'running', 'waiting_approval');
      const moved = await tx.runbookRunStep.updateMany({
        where: { id: loaded.stepRow.id, status: 'running' },
        data: {
          status: 'waiting_approval',
          aiTranscript: paused.state as unknown as Prisma.InputJsonValue,
          outputTail: session.sink.outputTail() || null,
          logBytes: session.sink.bytes,
          logTruncated: session.sink.truncated,
        },
      });
      if (moved.count !== 1) return null; // cancelled while the model was thinking
      await tx.runbookApproval.create({
        data: {
          id: draft.approvalId,
          orgId,
          runId: payload.runId,
          runTargetId: payload.targetId,
          // An AI step may ask several times: the approval's own id keeps each scope key unique.
          scopeKey: draft.approvalId,
          scope: 'target',
          kind: draft.kind,
          stepIndex: payload.stepIndex,
          stepName: step.name,
          message: draft.message,
          payload: draft.payload as Prisma.InputJsonValue,
          expiresAt: new Date(now.getTime() + expirySec * 1000),
        },
      });
      const run = await tx.runbookRun.findUniqueOrThrow({ where: { id: payload.runId }, select: { runbookId: true, version: true } });
      const targetsTotal = await tx.runbookRunTarget.count({ where: { runId: payload.runId } });
      return { ...run, targetsTotal };
    });
    if (!created) return;
    await this.events.publish({ type: 'step', runId: payload.runId, targetId: payload.targetId, stepIndex: payload.stepIndex, status: 'waiting_approval', exitCode: null, durationMs: null });
    await this.events.publish({ type: 'approval', runId: payload.runId, approvalId: draft.approvalId, status: 'pending', scope: 'target', kind: draft.kind });
    await this.lifecycle.notifyApprovers({
      approvalId: draft.approvalId,
      runId: payload.runId,
      orgId,
      runbookId: created.runbookId,
      version: created.version,
      stepName: step.name,
      targetsTotal: created.targetsTotal,
      kind: 'step',
    });
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
