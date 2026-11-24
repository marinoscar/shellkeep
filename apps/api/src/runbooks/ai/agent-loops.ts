// =============================================================================
// The three ways an AI step runs (issue #64)
// =============================================================================
//
//   autonomous_within_allowlist   `client.runTools(...)`: the platform's tool loop; the policy judges each
//                                 call; a refused call is answered to the model, the third ends the step.
//   per_command                   a loop of single provider round-trips this file drives itself, because
//                                 the conversation must be STOPPABLE: a `run_command` is not executed, it
//                                 becomes an approval and the job ends with the conversation stored. On
//                                 approval the next job replays the stored items, runs exactly that command
//                                 and carries on; a rejection is answered to the model as `{ rejected }`.
//   plan                          one `respondStructured` call yields the plan; a person approves it as a
//                                 whole; the approved commands run EXACTLY as approved, in order; a final
//                                 `respond` summarises. The model cannot add a command after approval.
//
// Every provider round-trip goes through `AiService.forUser(initiator, { orgId, feature: 'runbook_agent' })`:
// the platform's gates (kill switch, key policy, limits) run on each one, and the key never reaches this code.
// =============================================================================

import { randomUUID } from 'node:crypto';

import type { AiService } from '@marinoscar/platform-api/ai';

import { prepareModelOutput, redactForStorage } from './agent-output';
import { buildAgentInstructions, PLAN_INSTRUCTIONS_SUFFIX, SUMMARY_REQUEST } from './agent-prompt';
import { AgentSession, type AiTaskStep, type ToolResult } from './agent-session';
import { buildTools } from './agent-tools';
import {
  planDigest,
  planSchema,
  replayStored,
  sha256,
  toInputItems,
  type AgentPlan,
  type LoopState,
  type PlanState,
  type StoredCall,
} from './agent-transcript';
import { AI_FAILURE_CODES, MAX_SUMMARY_CHARS } from './runbook-agent.constants';

export type AiClient = ReturnType<AiService['forUser']>;

/** An approval the job wants created before it ends. */
export interface ApprovalDraft {
  kind: 'ai_command' | 'ai_plan';
  approvalId: string;
  /** Tells several approvals of one step apart (the approval's unique scope key carries it). */
  seq: number;
  message: string;
  payload: Record<string, unknown>;
}

export type AgentOutcome =
  | { kind: 'done'; summary: string; failed?: boolean }
  | { kind: 'failed'; code: string; message: string }
  | { kind: 'paused'; state: LoopState | PlanState; approval: ApprovalDraft };

export interface LoopContext {
  session: AgentSession;
  client: AiClient;
  step: AiTaskStep;
  /** The system instructions for a round with `stepsRemaining` rounds left. */
  instructions(stepsRemaining: number): string;
}

/** A person's decision on the approval a stored conversation was waiting for. */
export interface Decision {
  callId: string;
  status: 'approved' | 'rejected';
  decidedBy: string | null;
  comment: string | null;
}

export const START_MESSAGE = 'Carry out the task described in your instructions. Start now.';

export const newLoopState = (): LoopState => ({
  v: 1,
  kind: 'loop',
  items: [{ type: 'message', role: 'user', text: START_MESSAGE }],
  pending: [],
  awaiting: null,
  rounds: 0,
  refusals: 0,
  toolCalls: 0,
});

const failed = (code: string, message: string): AgentOutcome => ({ kind: 'failed', code, message });

/** The prompt of a step as the model sees it at the start of a round. */
export function instructionsFor(
  input: Omit<Parameters<typeof buildAgentInstructions>[0], 'stepsRemaining'>,
): (stepsRemaining: number) => string {
  return (stepsRemaining) => buildAgentInstructions({ ...input, stepsRemaining });
}

const asJson = (value: ToolResult): string => JSON.stringify(value);

// -----------------------------------------------------------------------------
// autonomous_within_allowlist
// -----------------------------------------------------------------------------

export async function runAutonomous(ctx: LoopContext): Promise<AgentOutcome> {
  const { session, client, step } = ctx;
  const tools = buildTools(step.tools, {
    runCommand: async ({ command, reason }) => {
      await session.assertLive();
      const verdict = session.judge(command);
      if (!verdict.allowed) return session.refuse('run_command', command, verdict);
      session.note(`run_command (${reason}): ${command}`);
      return session.resultFor(await session.execute('run_command', command, null));
    },
    readFile: async ({ path, maxBytes }) => {
      await session.assertLive();
      session.note(`read_file ${path}`);
      return session.readFile(path, maxBytes);
    },
    listDir: async ({ path }) => {
      await session.assertLive();
      session.note(`list_dir ${path}`);
      return session.listDir(path);
    },
  });
  const result = await client.runTools(
    {
      instructions: ctx.instructions(step.maxSteps),
      input: START_MESSAGE,
      tools,
      maxSteps: step.maxSteps,
      maxOutputTokens: step.maxOutputTokens,
      // The command's own timeout, its INT/KILL grace and some room: the tool timeout must never beat the command's.
      toolTimeoutMs: step.commandTimeoutSec * 1000 + 30_000,
      onStep: (s) => {
        if (s.response.outputText.trim() !== '') session.note(`model: ${s.response.outputText}`);
      },
    },
    { signal: session.signal },
  );
  if (result.stopReason === 'steps_exhausted') return failed(AI_FAILURE_CODES.AI_STEP_LIMIT, 'The AI used all its steps before it finished');
  return { kind: 'done', summary: result.final.outputText };
}

// -----------------------------------------------------------------------------
// per_command
// -----------------------------------------------------------------------------

type Dispatched = { output: string } | { pause: ApprovalDraft };

/**
 * Drives the conversation from `state` (a fresh one, or a stored one with the decision on its awaited call)
 * until the model is done, the step fails, or a command needs a person.
 */
export async function runPerCommand(ctx: LoopContext, state: LoopState, decision: Decision | null): Promise<AgentOutcome> {
  const { session, client, step } = ctx;
  // The tools are only used for their schemas and argument parsing here: this loop executes the calls itself.
  const never = async (): Promise<never> => {
    throw new Error('not used');
  };
  const tools = buildTools(step.tools, { runCommand: never, readFile: never, listDir: never });
  const byName = new Map(tools.map((t) => [t.tool.name, t]));
  let pendingDecision = decision;

  const dispatch = async (call: StoredCall): Promise<Dispatched> => {
    const tool = byName.get(call.name);
    if (!tool) return { output: `Error: there is no tool named "${call.name}".` };
    const parsed = tool.parseArguments(call.arguments);
    if (!parsed.success) return { output: `Error: ${parsed.error}` };
    await session.assertLive();

    if (call.name === 'read_file') {
      const { path, maxBytes } = parsed.data as { path: string; maxBytes?: number };
      session.note(`read_file ${path}`);
      return { output: asJson(await session.readFile(path, maxBytes)) };
    }
    if (call.name === 'list_dir') {
      const { path } = parsed.data as { path: string };
      session.note(`list_dir ${path}`);
      return { output: asJson(await session.listDir(path)) };
    }

    const { command, reason } = parsed.data as { command: string; reason: string };
    const verdict = session.judge(command);
    if (!verdict.allowed) return { output: asJson(await session.refuse('run_command', command, verdict)) };

    if (pendingDecision && pendingDecision.callId === call.callId) {
      const made = pendingDecision;
      pendingDecision = null;
      const awaiting = state.awaiting;
      state.awaiting = null;
      if (made.status === 'rejected') return { output: asJson(await session.rejected('run_command', command, made.comment, made.decidedBy)) };
      // EXACTLY the command that was approved: the stored digest must match the call being run.
      if (!awaiting || awaiting.commandSha256 !== sha256(command)) session.end(AI_FAILURE_CODES.AI_APPROVAL_MISMATCH);
      session.note(`run_command (${reason}), approved: ${command}`);
      return { output: asJson(session.resultFor(await session.execute('run_command', command, made.decidedBy))) };
    }

    // Not approved yet: persist an approval and stop here.
    const approvalId = randomUUID();
    state.awaiting = { approvalId, callId: call.callId, commandSha256: sha256(command) };
    await session.pending('run_command', command, approvalId);
    session.note(`waiting for approval: ${command}`);
    return {
      pause: {
        kind: 'ai_command',
        approvalId,
        seq: state.toolCalls,
        message: redactForStorage(reason, session.literals, 500),
        payload: {
          command: redactForStorage(command, session.literals, 4096),
          reason: redactForStorage(reason, session.literals, 500),
          commandSha256: sha256(command),
        },
      },
    };
  };

  for (;;) {
    if (state.pending.length === 0) {
      if (state.rounds >= step.maxSteps) return failed(AI_FAILURE_CODES.AI_STEP_LIMIT, 'The AI used all its steps before it finished');
      await session.assertLive();
      const response = await client.respond(
        {
          instructions: ctx.instructions(step.maxSteps - state.rounds),
          input: toInputItems(state.items),
          tools: tools.map((t) => t.tool),
          maxOutputTokens: step.maxOutputTokens,
        },
        { signal: session.signal },
      );
      state.rounds += 1;
      state.items.push(...replayStored(response.output));
      if (response.outputText.trim() !== '') session.note(`model: ${response.outputText}`);
      const calls: StoredCall[] = response.output
        .filter((item) => item.type === 'function_call')
        .map((item) => ({ callId: item.callId, name: item.name, arguments: item.arguments }));
      if (calls.length === 0) return { kind: 'done', summary: response.outputText };
      // The last round's calls are never executed (the same rule as `runTools`).
      if (state.rounds >= step.maxSteps) return failed(AI_FAILURE_CODES.AI_STEP_LIMIT, 'The AI used all its steps before it finished');
      state.pending = calls;
    }

    const call = state.pending[0]!;
    const out = await dispatch(call);
    if ('pause' in out) {
      state.refusals = session.refusals;
      return { kind: 'paused', state, approval: out.pause };
    }
    state.items.push({ type: 'function_call_output', callId: call.callId, output: out.output });
    state.pending.shift();
    state.toolCalls += 1;
  }
}

// -----------------------------------------------------------------------------
// plan
// -----------------------------------------------------------------------------

/** One `respondStructured` call, the policy check of every command, and one approval for the whole plan. */
export async function startPlan(ctx: LoopContext): Promise<AgentOutcome> {
  const { session, client, step } = ctx;
  const answer = await client.respondStructured(
    {
      instructions: `${ctx.instructions(1)}${PLAN_INSTRUCTIONS_SUFFIX}`,
      input: START_MESSAGE,
      schema: planSchema,
      schemaName: 'runbook_plan',
      maxOutputTokens: step.maxOutputTokens,
    },
    { signal: session.signal },
  );
  const plan: AgentPlan = answer.parsed;
  session.note(`plan: ${plan.summary}`);

  const verdicts = plan.commands.map((c) => session.judge(c.command));
  if (verdicts.every((v) => !v.allowed)) {
    // Nothing in the plan may run: record each refusal (the third ends the step) and fail.
    for (const [i, verdict] of verdicts.entries()) {
      if (!verdict.allowed) await session.refuse('run_command', plan.commands[i]!.command, verdict);
    }
    return failed(AI_FAILURE_CODES.AI_POLICY_VIOLATIONS, 'Every command of the plan is refused by the policy');
  }

  const approvalId = randomUUID();
  const state: PlanState = { v: 1, kind: 'plan', plan, approvalId, planSha256: planDigest(plan) };
  await session.pending('run_command', JSON.stringify(plan.commands.map((c) => c.command)), approvalId);
  session.note(`waiting for approval of a plan of ${plan.commands.length} command(s)`);
  return {
    kind: 'paused',
    state,
    approval: {
      kind: 'ai_plan',
      approvalId,
      seq: 0,
      message: redactForStorage(plan.summary, session.literals, 2000),
      payload: {
        summary: redactForStorage(plan.summary, session.literals, 4000),
        commands: plan.commands.map((c, i) => {
          const verdict = verdicts[i]!;
          return {
            command: redactForStorage(c.command, session.literals, 4096),
            reason: redactForStorage(c.reason, session.literals, 500),
            refused: verdict.allowed ? null : verdict.code,
          };
        }),
        planSha256: state.planSha256,
      },
    },
  };
}

/** Runs the commands of an approved plan exactly as approved, then asks the model to summarise. */
export async function executePlan(ctx: LoopContext, state: PlanState, decidedBy: string | null): Promise<AgentOutcome> {
  const { session, client, step } = ctx;
  if (planDigest(state.plan) !== state.planSha256) session.end(AI_FAILURE_CODES.AI_APPROVAL_MISMATCH);

  const lines: string[] = [];
  let anyFailed = false;
  for (const [i, entry] of state.plan.commands.entries()) {
    await session.assertLive();
    const verdict = session.judge(entry.command);
    const label = `${i + 1}. ${redactForStorage(entry.command, session.literals, 1000)}`;
    if (!verdict.allowed) {
      await session.refuse('run_command', entry.command, verdict);
      lines.push(`${label}\n   skipped: refused by the policy (${verdict.code})`);
      continue;
    }
    session.note(`run_command (${entry.reason}), approved plan step ${i + 1}: ${entry.command}`);
    const outcome = await session.execute('run_command', entry.command, decidedBy);
    const out = prepareModelOutput(outcome.raw, session.literals, 2048);
    const bad = outcome.timedOut || outcome.exitCode !== 0;
    lines.push(`${label}\n   exit code ${outcome.exitCode ?? 'none'}${outcome.timedOut ? ' (timed out)' : ''}\n   output: ${out.text.trim() === '' ? '(none)' : out.text}`);
    if (bad) {
      anyFailed = true;
      if (!step.continueOnError) {
        lines.push(`${state.plan.commands.length - i - 1} later command(s) did not run because this one failed.`);
        break;
      }
    }
  }

  let summary: string;
  try {
    const answer = await client.respond(
      {
        instructions: ctx.instructions(1),
        input: `Plan: ${state.plan.summary}\n\nResults:\n${lines.join('\n')}\n\n${SUMMARY_REQUEST}`,
        maxOutputTokens: step.maxOutputTokens,
      },
      { signal: session.signal },
    );
    summary = answer.outputText;
  } catch (error) {
    // Cancel and stop propagate (they set `endReason`); a provider fault must not undo commands that already ran.
    if (session.endReason) throw error;
    summary = `The approved commands ran (${anyFailed ? 'at least one failed' : 'all succeeded'}); the summary could not be written.`;
  }
  return { kind: 'done', summary: redactForStorage(summary, session.literals, MAX_SUMMARY_CHARS), failed: anyFailed };
}
