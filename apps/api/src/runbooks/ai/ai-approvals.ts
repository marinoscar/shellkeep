// =============================================================================
// Deciding the approval of an AI step (issue #64)
// =============================================================================
//
// `ai_command` (one command of a `per_command` step) and `ai_plan` (the plan of a `plan` step) are rows of
// `runbook_approvals` like a gate's, but they park ONE step, and a decision either wakes the agent or ends
// the step:
//
//   approved                    step `waiting_approval -> running`; the agent job is queued (`phase: 'resume'`)
//                               and runs EXACTLY what was approved
//   rejected  ai_command        the same: the agent is told `{ rejected }` and carries on
//   rejected  ai_plan           the step fails `APPROVAL_REJECTED`; the target goes on at the next step
//   expired                     the step fails `APPROVAL_EXPIRED`
//   stopped ("Stop AI")         the step fails `AI_STOPPED`
//
// A step that fails hands the target back (`waiting -> queued` at the next step, one `runbook.target.run`), so
// `always` and `on_failure` steps after it still run. Everything happens in the caller's transaction; the
// events are published after the commit by the caller.
// =============================================================================

import { JobsService, type JobsTx } from '@marinoscar/platform-api/jobs';
import { Prisma } from '@prisma/client';

import { FAILURE_CODES, RUNBOOK_JOB_REASON, RUNBOOK_RUN_TARGET_SUBJECT, RUNBOOK_TARGET_RUN_TYPE } from '../engine/engine.constants';
import type { RunEvent } from '../engine/run-events';
import { RunCoordinatorService, type OrgTx } from '../engine/run-coordinator.service';
import { assertTransition } from '../engine/state-machine';
import { AI_FAILURE_CODES } from './runbook-agent.constants';

export const AI_APPROVAL_KINDS: readonly string[] = ['ai_command', 'ai_plan'];

export const isAiApproval = (kind: string): boolean => AI_APPROVAL_KINDS.includes(kind);

export interface AiApprovalRow {
  id: string;
  orgId: string;
  runId: string;
  runTargetId: string | null;
  kind: string;
  stepIndex: number;
}

export interface AiApprovalDeps {
  jobs: JobsService;
  coordinator: RunCoordinatorService;
}

/** Applies a decision already written on the approval row. `stopped` is "Stop AI": the step fails `AI_STOPPED`. */
export async function applyAiApproval(
  tx: OrgTx,
  deps: AiApprovalDeps,
  approval: AiApprovalRow,
  outcome: 'approved' | 'rejected' | 'expired',
  now: Date,
  events: RunEvent[],
  options: { stopped?: boolean } = {},
): Promise<void> {
  const { runId, orgId, stepIndex } = approval;
  const targetId = approval.runTargetId;
  if (!targetId) return;
  const step = await tx.runbookRunStep.findFirst({ where: { runId, runTargetId: targetId, stepIndex, status: 'waiting_approval' }, select: { id: true } });
  const target = await tx.runbookRunTarget.findFirst({ where: { id: targetId, runId, status: 'waiting' }, select: { id: true } });
  // Nothing parked on this approval any more (the run was cancelled meanwhile): the row's decision stands, nothing wakes.
  if (!step || !target) return;

  const wake = !options.stopped && (outcome === 'approved' || (outcome === 'rejected' && approval.kind === 'ai_command'));
  if (wake) {
    assertTransition('step', 'waiting_approval', 'running');
    await tx.runbookRunStep.update({ where: { id: step.id }, data: { status: 'running' } });
    await deps.coordinator.enqueueAiAgent(tx, { orgId, runId, targetId, stepIndex, phase: 'resume' });
    events.push({ type: 'step', runId, targetId, stepIndex, status: 'running' });
    return;
  }

  const code = options.stopped ? AI_FAILURE_CODES.AI_STOPPED : outcome === 'rejected' ? FAILURE_CODES.APPROVAL_REJECTED : FAILURE_CODES.APPROVAL_EXPIRED;
  assertTransition('step', 'waiting_approval', 'failed');
  assertTransition('target', 'waiting', 'queued');
  await tx.runbookRunStep.update({
    where: { id: step.id },
    data: { status: 'failed', errorCode: code, aiTranscript: Prisma.DbNull, finishedAt: now },
  });
  await tx.runbookRunTarget.update({ where: { id: targetId }, data: { status: 'queued', nextStepIndex: stepIndex + 1 } });
  await deps.jobs.enqueueWithin(tx as unknown as JobsTx, {
    type: RUNBOOK_TARGET_RUN_TYPE,
    reason: RUNBOOK_JOB_REASON,
    orgId,
    subjectType: RUNBOOK_RUN_TARGET_SUBJECT,
    subjectId: targetId,
    payload: { runId, targetId, fromStepIndex: stepIndex + 1 },
  });
  events.push({ type: 'step', runId, targetId, stepIndex, status: 'failed' });
  events.push({ type: 'target', runId, targetId, status: 'queued' });
}
