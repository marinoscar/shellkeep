// =============================================================================
// The AI runbook step's permanent names (issue #64)
// =============================================================================
//
// The job type string is PERMANENT once jobs of that type exist (`test/jobs/job-type-snapshot.spec.ts`
// pins it). The failure codes are stored on step rows and shown in the UI: never rename one.
// =============================================================================

import { z } from 'zod';

/** The agent job. An `ai.*` type: server-only, permanently (no `nodeResultSchema`, no `persistNodeResult`). */
export const RUNBOOK_AGENT_TYPE = 'ai.runbook.agent';

/** The AI feature ids (registered in `app-registrations/ai.ts`). */
export const RUNBOOK_AGENT_FEATURE = 'runbook_agent';
export const RUNBOOK_DRAFT_FEATURE = 'runbook_draft';

/** Refusals an agent may collect before the step is aborted. */
export const MAX_REFUSALS = 3;

/** Longest closing summary stored on the step. */
export const MAX_SUMMARY_CHARS = 8000;

export const agentPayloadSchema = z.object({
  runId: z.string().uuid(),
  targetId: z.string().uuid(),
  stepIndex: z.number().int().min(0),
  orgId: z.string().uuid(),
  phase: z.enum(['start', 'resume']),
});
export type AgentPayload = z.infer<typeof agentPayloadSchema>;

/** The codes an AI step stores on its step row (`error_code`). */
export const AI_FAILURE_CODES = {
  /** `runbooks.ai.agentEnabled` is off (the deployment's or the organization's setting). */
  RUNBOOK_AI_DISABLED: 'RUNBOOK_AI_DISABLED',
  /** The platform AI switch is off (the `AiService` pipeline raises the same code). */
  AI_DISABLED: 'AI_DISABLED',
  /** The server's `aiOutputSharing` is off: an agent cannot work blind. */
  AI_OUTPUT_SHARING_DISABLED: 'AI_OUTPUT_SHARING_DISABLED',
  /** The agent collected three refusals. */
  AI_POLICY_VIOLATIONS: 'AI_POLICY_VIOLATIONS',
  /** "Stop AI" was requested. */
  AI_STOPPED: 'AI_STOPPED',
  /** The step's `maxSteps` model rounds were used and the model still wanted to call tools. */
  AI_STEP_LIMIT: 'AI_STEP_LIMIT',
  /** The provider failed in a way no retry fixes and the platform has no code for. */
  AI_FAILED: 'AI_FAILED',
  /** The approved command or plan is not the one that was stored. */
  AI_APPROVAL_MISMATCH: 'AI_APPROVAL_MISMATCH',
} as const;
export type AiFailureCode = (typeof AI_FAILURE_CODES)[keyof typeof AI_FAILURE_CODES];

/** The job reason and subject the engine already registered; the agent job rides on them. */
export { RUNBOOK_JOB_REASON, RUNBOOK_RUN_TARGET_SUBJECT } from '../engine/engine.constants';
