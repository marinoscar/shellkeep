// =============================================================================
// ShellKeep's runbook webhook events (issue #66)
// =============================================================================
//
// Registered into the webhooks slice's open catalog at import time, by `app-registrations/webhooks.ts`, before
// the registry freezes at bootstrap. EVENT KEYS ARE PERMANENT: a receiver subscribes to a key. Add one; never
// rename one.
//
//   runbook.run.completed       a (real) run reached a terminal status
//   runbook.approval.requested  a run is waiting for an approval
//
// AUDIENCE `org`: the organization's endpoints receive it, each only if its owner still holds `runbooks:read`.
//
// METADATA ONLY. Ids, the runbook's name, the status, counts, times and a link: never a command, an output, a
// parameter, a secret, a host or a user name. The schemas are strict, so a field added by accident fails
// validation and nothing is sent. A dry run never raises `runbook.run.completed` (the finished event is
// suppressed for a rehearsal).
// =============================================================================

import { z } from 'zod';
import { registerWebhookEvent } from '@marinoscar/platform-api/webhooks';

export const RUNBOOK_WEBHOOK_EVENTS = {
  RUN_COMPLETED: 'runbook.run.completed',
  APPROVAL_REQUESTED: 'runbook.approval.requested',
} as const;

const isoTimestamp = z.iso.datetime();

export const RUN_COMPLETED_STATUSES = ['succeeded', 'partially_failed', 'failed', 'aborted', 'cancelled'] as const;

export const runbookRunCompletedSchema = z
  .object({
    runId: z.uuid(),
    runbookId: z.uuid(),
    runbookName: z.string().min(1).max(200),
    version: z.number().int().min(1),
    status: z.enum(RUN_COMPLETED_STATUSES),
    trigger: z.enum(['manual', 'api', 'schedule']),
    scheduleId: z.uuid().optional(),
    counts: z
      .object({
        total: z.number().int().min(0),
        succeeded: z.number().int().min(0),
        failed: z.number().int().min(0),
        cancelled: z.number().int().min(0),
        skipped: z.number().int().min(0),
      })
      .strict(),
    startedAt: isoTimestamp.nullable(),
    finishedAt: isoTimestamp,
    url: z.string().min(1).max(2000),
  })
  .strict();
export type RunbookRunCompletedData = z.infer<typeof runbookRunCompletedSchema>;

export const runbookApprovalRequestedSchema = z
  .object({
    approvalId: z.uuid(),
    runId: z.uuid(),
    kind: z.enum(['step', 'gate', 'destructive_run']),
    runbookName: z.string().min(1).max(200),
    expiresAt: isoTimestamp,
    url: z.string().min(1).max(2000),
  })
  .strict();
export type RunbookApprovalRequestedData = z.infer<typeof runbookApprovalRequestedSchema>;

const ID_1 = '00000000-0000-4000-8000-000000000011';
const ID_2 = '00000000-0000-4000-8000-000000000012';
const ID_3 = '00000000-0000-4000-8000-000000000013';

let registered = false;

/** Registers the two events. Idempotent per process (a second registration is `DUPLICATE_ID`). */
export function registerRunbookWebhookEvents(): void {
  if (registered) return;
  registered = true;

  registerWebhookEvent({
    key: RUNBOOK_WEBHOOK_EVENTS.RUN_COMPLETED,
    label: 'Runbook run completed',
    description: 'A runbook run reached a terminal status. Carries ids, the runbook name, the status and target counts, never commands or output.',
    group: 'Runbooks',
    audience: 'org',
    permission: 'runbooks:read',
    payloadSchema: runbookRunCompletedSchema,
    example: {
      runId: ID_1,
      runbookId: ID_2,
      runbookName: 'Rotate logs',
      version: 3,
      status: 'succeeded',
      trigger: 'schedule',
      scheduleId: ID_3,
      counts: { total: 4, succeeded: 4, failed: 0, cancelled: 0, skipped: 0 },
      startedAt: '2026-11-01T02:00:05.000Z',
      finishedAt: '2026-11-01T02:03:40.000Z',
      url: 'https://app.example.test/runbooks/runs/00000000-0000-4000-8000-000000000011',
    } satisfies RunbookRunCompletedData,
    source: 'runbooks',
  });

  registerWebhookEvent({
    key: RUNBOOK_WEBHOOK_EVENTS.APPROVAL_REQUESTED,
    label: 'Runbook approval requested',
    description: 'A runbook run is waiting for an approval. Carries ids, the kind and the expiry, never the command text.',
    group: 'Runbooks',
    audience: 'org',
    permission: 'runbooks:read',
    payloadSchema: runbookApprovalRequestedSchema,
    example: {
      approvalId: ID_3,
      runId: ID_1,
      kind: 'gate',
      runbookName: 'Rotate logs',
      expiresAt: '2026-11-01T03:00:00.000Z',
      url: 'https://app.example.test/runbooks/approvals?approval=00000000-0000-4000-8000-000000000013',
    } satisfies RunbookApprovalRequestedData,
    source: 'runbooks',
  });
}
