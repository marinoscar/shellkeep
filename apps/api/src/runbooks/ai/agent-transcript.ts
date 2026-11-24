// =============================================================================
// The stored conversation of an AI runbook step (issue #64)
// =============================================================================
//
// PURE. While a step waits for a person's approval (`per_command`, `plan`) the job ends; the conversation
// lives in `runbook_run_steps.ai_transcript` so `phase: 'resume'` can replay it as the model's input.
//
// WHAT IS STORED. Input items only: messages, function calls and function-call outputs, as plain JSON.
// Tool outputs were redacted before they were added (`prepareModelOutput`). The model's own text and
// commands are stored as the model wrote them: it never saw a secret value, so it cannot repeat one (and
// anything secret-shaped it invented is redacted by the log sink and the approval payload, not altered here,
// because the command that runs must be EXACTLY the command that was approved: its sha256 is kept
// beside the approval and checked on resume).
//
// Reasoning items are not stored: their provider state is not JSON.
// =============================================================================

import { createHash } from 'node:crypto';

import type { AiInputItem } from '@marinoscar/platform-api/ai';
import { z } from 'zod';

export const storedItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), role: z.enum(['user', 'assistant', 'system', 'developer']), text: z.string() }),
  z.object({ type: z.literal('function_call'), callId: z.string(), name: z.string(), arguments: z.string() }),
  z.object({ type: z.literal('function_call_output'), callId: z.string(), output: z.string() }),
]);
export type StoredItem = z.infer<typeof storedItemSchema>;

export const storedCallSchema = z.object({ callId: z.string(), name: z.string(), arguments: z.string() });
export type StoredCall = z.infer<typeof storedCallSchema>;

/** The loop modes (`per_command`, `autonomous_within_allowlist`). */
export const loopStateSchema = z.object({
  v: z.literal(1),
  kind: z.literal('loop'),
  /** Everything sent to the model so far, in order; includes the calls and outputs of the round in progress. */
  items: z.array(storedItemSchema),
  /** Calls of the round in progress that still need an answer; the head may be waiting for an approval. */
  pending: z.array(storedCallSchema),
  awaiting: z.object({ approvalId: z.string().uuid(), callId: z.string(), commandSha256: z.string() }).nullable(),
  /** Provider round-trips used. */
  rounds: z.number().int().min(0),
  refusals: z.number().int().min(0),
  toolCalls: z.number().int().min(0),
});
export type LoopState = z.infer<typeof loopStateSchema>;

const planCommandSchema = z.object({ command: z.string().min(1).max(4096), reason: z.string().min(1).max(500) });
export const planSchema = z.object({ summary: z.string().max(4000), commands: z.array(planCommandSchema).min(1).max(20) });
export type AgentPlan = z.infer<typeof planSchema>;

/** The `plan` mode: the plan a person approved, as it was approved. */
export const planStateSchema = z.object({
  v: z.literal(1),
  kind: z.literal('plan'),
  plan: planSchema,
  approvalId: z.string().uuid(),
  /** sha256 of the canonical plan: checked before anything runs. */
  planSha256: z.string(),
});
export type PlanState = z.infer<typeof planStateSchema>;

export const agentStateSchema = z.discriminatedUnion('kind', [loopStateSchema, planStateSchema]);
export type AgentState = z.infer<typeof agentStateSchema>;

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** A stable digest of a plan: the commands and reasons in order. */
export const planDigest = (plan: AgentPlan): string => sha256(JSON.stringify(plan.commands.map((c) => [c.command, c.reason])));

/** Stored items as the provider's input items. */
export function toInputItems(items: readonly StoredItem[]): AiInputItem[] {
  return items.map((item): AiInputItem => {
    if (item.type === 'message') return { type: 'message', role: item.role, content: [{ type: 'text', text: item.text }] };
    if (item.type === 'function_call') return { type: 'function_call', callId: item.callId, name: item.name, arguments: item.arguments };
    return { type: 'function_call_output', callId: item.callId, output: item.output };
  });
}

/** One response's output as the items that replay it (messages and calls; reasoning is dropped). */
export function replayStored(output: ReadonlyArray<{ type: string; text?: string; callId?: string; name?: string; arguments?: string }>): StoredItem[] {
  const items: StoredItem[] = [];
  for (const item of output) {
    if (item.type === 'message' && typeof item.text === 'string' && item.text.length > 0) {
      items.push({ type: 'message', role: 'assistant', text: item.text });
    } else if (item.type === 'function_call' && item.callId && item.name !== undefined && item.arguments !== undefined) {
      items.push({ type: 'function_call', callId: item.callId, name: item.name, arguments: item.arguments });
    }
  }
  return items;
}
