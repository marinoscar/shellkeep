// =============================================================================
// One AI step, one job: the shared machinery of the agent (issue #64)
// =============================================================================
//
// `AgentSession` is built by `RunbookAgentHandler` for ONE job and holds what every tool call needs: the SSH
// connection, the run's parameters and secrets, the command policy, the step's log sink and the stop
// signals. It is the ONLY place a model-requested command reaches a server:
//
//   judge(command)        the policy (`agent-policy.ts`); a refusal writes its own audit row
//   execute(script)       one command through `SshExecutor`: the same stdin prelude, `runAs`, timeout and
//                         environment as a step, a `runbook_command_executions` row with `origin: 'ai_agent'`
//   readFile / listDir    `head -c` and `ls -la` over the same path, after `policy.checkPath`
//
// WHAT THE MODEL SEES of a result is `prepareModelOutput`: ANSI stripped, redacted with the run's secret
// literals, cut to 8 KiB. WHAT THE LOG SEES is the same text through the sink (which redacts again).
// Nothing here logs, traces or stores a command's text or output in the clear: the audit row keeps a hash
// and a redacted preview.
//
// ENDING THE LOOP. `end(code)` records why, aborts the loop's signal and throws `AgentEnd`; the handler maps
// the code to the step's failure. "Stop AI" is read from the run row before every tool execution and by a
// short poll that also kills a command in flight.
// =============================================================================

import { Logger } from '@nestjs/common';
import { runInOrg, type AuditSink } from '@marinoscar/platform-api/core';
import type { Client } from 'ssh2';

import { recordAudit } from '../../common/audit/record-audit';
import { redactText } from '../../command-safety';
import { PrismaService } from '../../prisma/prisma.service';
import { COMMAND_PREVIEW_BYTES } from '../engine/engine.constants';
import { EngineMetricsService } from '../engine/engine-metrics.service';
import { LogSink, splitUtf8 } from '../engine/log-sink';
import type { OrgTx } from '../engine/run-coordinator.service';
import { RunEventsService } from '../engine/run-events.service';
import { SshExecutor, sha256Hex, shellQuote, type SshExecRequest } from '../engine/ssh-executor';
import type { RunbookStep } from '../schema/runbook-definition.schema';
import { AgentPolicy, type PolicyDecision } from './agent-policy';
import { prepareModelOutput, redactForStorage } from './agent-output';
import { AI_FAILURE_CODES, MAX_REFUSALS } from './runbook-agent.constants';

export type AiTaskStep = Extract<RunbookStep, { kind: 'ai_task' }>;
export type AgentTool = 'run_command' | 'read_file' | 'list_dir';

/** Thrown by a tool to stop the loop; `code` is the step's failure code (or `CANCELLED`). */
export class AgentEnd extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AgentEnd';
  }
}

export interface SessionDeps {
  prisma: PrismaService;
  executor: SshExecutor;
  events: RunEventsService;
  metrics: EngineMetricsService;
  auditSink: AuditSink;
  logger: Logger;
}

export interface SessionInit {
  orgId: string;
  runId: string;
  targetId: string;
  stepIndex: number;
  stepRowId: string;
  step: AiTaskStep;
  initiatorUserId: string;
  params: Record<string, string>;
  secrets: Record<string, string>;
  profileId: string;
  /** Opens the verified SSH connection on first use; throws `AgentEnd(code)` when it cannot (host key, auth, unreachable). */
  connect: () => Promise<Client>;
  /** Aborts when the run or the target is cancelled. */
  cancelSignal: AbortSignal;
  /** Refusals already counted by earlier jobs of this step. */
  refusals: number;
  /** Where the sink continues in the step's log. */
  startSeq: number;
  startBytes: number;
  maxLogBytes: number;
}

export interface ExecOutcome {
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  sudoPasswordRequired: boolean;
  /** Raw output (both streams), capped; for `prepareModelOutput` only. */
  raw: string;
}

/** What a tool hands back to the model: always JSON-serialisable and already sanitised. */
export type ToolResult = Record<string, unknown>;

const MAX_COLLECT_BYTES = 512 * 1024;
const STOP_POLL_MS = 2_000;

/** The step's log sink (one per job: a step that waits for an approval spans several). */
export function makeSink(
  deps: Pick<SessionDeps, 'prisma' | 'events'>,
  init: Pick<SessionInit, 'orgId' | 'runId' | 'targetId' | 'stepIndex' | 'stepRowId' | 'startSeq' | 'startBytes' | 'maxLogBytes'>,
  literals: readonly string[],
): LogSink {
  return new LogSink({
    runId: init.runId,
    targetId: init.targetId,
    stepIndex: init.stepIndex,
    runStepId: init.stepRowId,
    secrets: literals,
    maxBytes: init.maxLogBytes,
    startSeq: init.startSeq,
    startBytes: init.startBytes,
    ports: {
      insertChunk: (chunk) =>
        runInOrg(deps.prisma, { orgId: init.orgId }, async (tx) => {
          await tx.runbookRunLogChunk.create({
            data: { orgId: init.orgId, runId: init.runId, runStepId: chunk.runStepId, seq: chunk.seq, stream: chunk.stream, data: chunk.data, bytes: chunk.bytes },
          });
        }),
      publish: (event) => deps.events.publish(event),
    },
  });
}

export class AgentSession {
  readonly policy: AgentPolicy;
  readonly literals: string[];
  readonly sink: LogSink;
  /** The signal commands and the model loop run under: cancel, stop or an ended loop. */
  readonly signal: AbortSignal;
  refusals: number;
  /** Commands that actually reached the server in this job (a throttle may only defer when none did). */
  executed = 0;
  endReason: string | null = null;

  private client: Promise<Client> | null = null;
  private readonly stopController = new AbortController();
  private readonly loopController = new AbortController();
  private stopTimer: NodeJS.Timeout | undefined;
  private stopPolling = false;

  constructor(
    private readonly deps: SessionDeps,
    readonly init: SessionInit,
  ) {
    this.policy = new AgentPolicy({ approvalMode: init.step.approvalMode, allow: init.step.allow, deny: init.step.deny });
    this.literals = Object.values(init.secrets).filter((s) => s.length > 0);
    this.refusals = init.refusals;
    this.signal = AbortSignal.any([init.cancelSignal, this.stopController.signal, this.loopController.signal]);
    this.sink = makeSink(deps, init, this.literals);
  }

  inOrg<T>(fn: (tx: OrgTx) => Promise<T>): Promise<T> {
    return runInOrg(this.deps.prisma, { orgId: this.init.orgId }, fn);
  }

  /** Starts the poll that notices "Stop AI" while a command is running. */
  start(): this {
    this.stopTimer = setInterval(() => void this.pollStop(), STOP_POLL_MS);
    this.stopTimer.unref();
    return this;
  }

  /** Stops the poll and closes the connection, if one was opened. */
  async close(): Promise<void> {
    if (this.stopTimer) clearInterval(this.stopTimer);
    const opened = this.client;
    this.client = null;
    if (!opened) return;
    try {
      const client = await opened;
      client.end();
      client.destroy();
    } catch {
      // never opened, or already closed
    }
  }

  private async getClient(): Promise<Client> {
    this.client ??= this.init.connect();
    try {
      return await this.client;
    } catch (error) {
      this.client = null;
      if (error instanceof AgentEnd) return this.end(error.code);
      throw error;
    }
  }

  private async pollStop(): Promise<void> {
    if (this.stopPolling || this.signal.aborted) return;
    this.stopPolling = true;
    try {
      if (await this.stopRequested()) {
        this.endReason ??= AI_FAILURE_CODES.AI_STOPPED;
        this.stopController.abort();
      }
    } catch {
      // the next poll tries again
    } finally {
      this.stopPolling = false;
    }
  }

  private async stopRequested(): Promise<boolean> {
    const run = await this.inOrg((tx) => tx.runbookRun.findUnique({ where: { id: this.init.runId }, select: { aiStopRequestedAt: true } }));
    return run?.aiStopRequestedAt != null;
  }

  /** Ends the loop with `code` and throws. */
  end(code: string): never {
    this.endReason ??= code;
    this.loopController.abort();
    throw new AgentEnd(code);
  }

  /** Called before every tool execution: a cancel or "Stop AI" ends the step BEFORE the next command runs. */
  async assertLive(): Promise<void> {
    if (this.init.cancelSignal.aborted) this.end('CANCELLED');
    if (this.signal.aborted && this.endReason) this.end(this.endReason);
    if (await this.stopRequested()) {
      this.stopController.abort();
      this.end(AI_FAILURE_CODES.AI_STOPPED);
    }
  }

  // ---------------------------------------------------------------------------
  // The log
  // ---------------------------------------------------------------------------

  /** One line of the transcript, in the step's log as a `system` line (the sink redacts it again). */
  note(text: string): void {
    this.sink.system(`[ai] ${redactForStorage(text, this.literals, 2000)}\n`);
  }

  // ---------------------------------------------------------------------------
  // Judging and recording
  // ---------------------------------------------------------------------------

  judge(command: string): PolicyDecision {
    return this.policy.checkCommand(command);
  }

  private preview(text: string): string {
    const clipped = splitUtf8(text, COMMAND_PREVIEW_BYTES)[0] ?? '';
    return redactText(clipped, { extraLiterals: this.literals }).text;
  }

  private async insertExecution(text: string, extra: { outcome?: string; approvedBy?: string | null; finished?: boolean }): Promise<string> {
    return this.inOrg(async (tx) => {
      const row = await tx.runbookCommandExecution.create({
        data: {
          orgId: this.init.orgId,
          serverProfileId: this.init.profileId,
          runStepId: this.init.stepRowId,
          origin: 'ai_agent',
          commandSha256: sha256Hex(text),
          commandPreview: this.preview(text),
          ...(extra.outcome ? { outcome: extra.outcome } : {}),
          ...(extra.approvedBy ? { approvedBy: extra.approvedBy } : {}),
          ...(extra.finished ? { finishedAt: new Date() } : {}),
        },
        select: { id: true },
      });
      return row.id;
    });
  }

  private audit(action: string, meta: Record<string, string | number | boolean | null>): Promise<void> {
    return recordAudit(this.deps.auditSink, this.deps.logger, {
      action,
      actorUserId: this.init.initiatorUserId,
      targetType: 'runbook_run',
      targetId: this.init.runId,
      meta: { targetId: this.init.targetId, stepIndex: this.init.stepIndex, ...meta },
    });
  }

  /**
   * A refused call: an audit row with `outcome: 'refused'`, a metric, a log line, and the result the model
   * sees. The third refusal ends the step (`AI_POLICY_VIOLATIONS`) instead of answering.
   */
  async refuse(tool: AgentTool, text: string, decision: Extract<PolicyDecision, { allowed: false }>): Promise<ToolResult> {
    this.refusals += 1;
    const executionId = await this.insertExecution(text, { outcome: 'refused', finished: true });
    this.deps.metrics.aiToolCall(tool, 'refused');
    this.note(`refused (${decision.code}): ${decision.reason}`);
    await this.audit('runbook_agent.command', { tool, decision: 'refused', code: decision.code, executionId, commandSha256: sha256Hex(text) });
    if (this.refusals >= MAX_REFUSALS) this.end(AI_FAILURE_CODES.AI_POLICY_VIOLATIONS);
    return { refused: true, reason: decision.reason };
  }

  /** The audit and metric of a call a person declined. */
  async rejected(tool: AgentTool, text: string, comment: string | null, decidedBy: string | null): Promise<ToolResult> {
    const executionId = await this.insertExecution(text, { outcome: 'rejected', finished: true });
    this.deps.metrics.aiToolCall(tool, 'rejected');
    this.note('the command was rejected by a person');
    await this.audit('runbook_agent.command', { tool, decision: 'rejected', executionId, commandSha256: sha256Hex(text), decidedBy });
    return { rejected: true, ...(comment ? { comment: redactForStorage(comment, this.literals, 1000) } : {}) };
  }

  /** The metric and audit of a call parked behind an approval. */
  async pending(tool: AgentTool, text: string, approvalId: string): Promise<void> {
    this.deps.metrics.aiToolCall(tool, 'pending_approval');
    await this.audit('runbook_agent.command', { tool, decision: 'pending_approval', approvalId, commandSha256: sha256Hex(text) });
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  /** Runs one command on the server. `approvedBy` is the person whose approval allowed it (null when none was needed). */
  async execute(tool: AgentTool, script: string, approvedBy: string | null): Promise<ExecOutcome> {
    await this.assertLive();
    const { step } = this.init;
    const client = await this.getClient();
    const executionId = await this.insertExecution(script, { approvedBy });
    const chunks: Buffer[] = [];
    let collected = 0;
    const runAs = step.runAs;
    const request: SshExecRequest = {
      script,
      interpreter: 'bash',
      strict: false,
      env: this.init.params,
      secrets: this.init.secrets,
      ...(runAs ? { runAs: { sudo: runAs.sudo ?? false, ...(runAs.user ? { user: runAs.user } : {}) } } : {}),
      timeoutSec: step.commandTimeoutSec,
      signal: this.signal,
      onChunk: (chunk) => {
        this.sink.push(chunk.stream, chunk.data);
        if (collected < MAX_COLLECT_BYTES) {
          chunks.push(chunk.data);
          collected += chunk.data.length;
        }
      },
      span: { stepKind: 'ai_task', stepIndex: this.init.stepIndex, serverProfileId: this.init.profileId },
    };

    let outcome: ExecOutcome;
    let status: 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
    try {
      const result = await this.deps.executor.exec(client, request);
      this.executed += 1;
      status = result.aborted ? 'cancelled' : result.timedOut ? 'timed_out' : result.exitCode === 0 ? 'succeeded' : 'failed';
      outcome = {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        aborted: result.aborted,
        sudoPasswordRequired: result.sudoPasswordRequired,
        raw: Buffer.concat(chunks).toString('utf8'),
      };
      await this.inOrg((tx) =>
        tx.runbookCommandExecution.update({
          where: { id: executionId },
          data: { exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, bytes: result.bytes, outcome: status, finishedAt: new Date() },
        }),
      );
    } catch (error) {
      this.deps.logger.warn(`ai command failed to run: ${error instanceof Error ? error.name : 'error'}`);
      await this.inOrg((tx) =>
        tx.runbookCommandExecution.update({ where: { id: executionId }, data: { outcome: 'failed', finishedAt: new Date() } }),
      ).catch(() => undefined);
      this.deps.metrics.command('ai_agent', 'error');
      this.deps.metrics.aiToolCall(tool, 'executed');
      this.end('SSH_UNREACHABLE');
    }
    this.deps.metrics.command('ai_agent', status);
    this.deps.metrics.aiToolCall(tool, 'executed');
    await this.audit('runbook_agent.command', {
      tool,
      decision: 'executed',
      executionId,
      commandSha256: sha256Hex(script),
      exitCode: outcome.exitCode,
      approvedBy,
    });
    if (outcome.aborted) this.end(this.endReason ?? (this.init.cancelSignal.aborted ? 'CANCELLED' : AI_FAILURE_CODES.AI_STOPPED));
    return outcome;
  }

  /** What the model is told of an executed command. */
  resultFor(outcome: ExecOutcome): ToolResult {
    const out = prepareModelOutput(outcome.raw, this.literals);
    return {
      exitCode: outcome.exitCode,
      ...(outcome.timedOut ? { timedOut: true } : {}),
      ...(outcome.sudoPasswordRequired ? { error: 'sudo needs a password; commands run non-interactively' } : {}),
      output: out.text,
    };
  }

  async readFile(path: string, maxBytes: number | undefined): Promise<ToolResult> {
    const decision = this.policy.checkPath(path);
    const limit = Math.min(maxBytes ?? 16_384, 65_536);
    const text = `head -c ${limit} -- ${shellQuote(path)}`;
    if (!decision.allowed) return this.refuse('read_file', text, decision);
    return this.resultFor(await this.execute('read_file', text, null));
  }

  async listDir(path: string): Promise<ToolResult> {
    const decision = this.policy.checkPath(path);
    const text = `ls -la -- ${shellQuote(path)}`;
    if (!decision.allowed) return this.refuse('list_dir', text, decision);
    return this.resultFor(await this.execute('list_dir', text, null));
  }
}
