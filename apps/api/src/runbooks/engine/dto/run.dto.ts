import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { targetSelectorSchema } from '../../schema/runbook-definition.schema';
import { RUNBOOK_SECRET_NAME_PATTERN } from '../../runbooks.credentials';

const strategyOverride = z
  .object({
    concurrency: z.number().int().min(1).max(50),
    batchSize: z.number().int().min(1).max(500),
    maxFailures: z.union([z.object({ count: z.number().int().min(0) }), z.object({ percent: z.number().min(0).max(100) })]),
    abortInFlight: z.boolean(),
    pauseAfterFirstBatch: z.boolean(),
  })
  .partial()
  .strict();

/** The launch-time confirmation of a destructive run (#67): the runbook's exact name and the resolved server count. */
export const runConfirmSchema = z.object({
  runbookName: z.string().max(120),
  targetCount: z.number().int().min(0),
});

export const createRunSchema = z.object({
  /** A rehearsal (#67): connects and checks every step, executes nothing that changes a server. */
  dryRun: z.boolean().default(false),
  /** Required to launch a runbook with a destructive step for real (not for a dry run). */
  confirm: runConfirmSchema.optional(),
  /** The version to run; the latest when absent. */
  version: z.number().int().min(1).optional(),
  params: z.record(z.string(), z.union([z.string().max(8192), z.number(), z.boolean()])).default({}),
  /** Secret parameter name to the name of a runbook secret. */
  secretRefs: z.record(z.string(), z.string().regex(RUNBOOK_SECRET_NAME_PATTERN)).default({}),
  targets: targetSelectorSchema.partial().optional(),
  strategy: strategyOverride.optional(),
});

export const runsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  runbookId: z.string().uuid().optional(),
  status: z
    .enum(['queued', 'resolving', 'running', 'paused', 'cancelling', 'succeeded', 'failed', 'partially_failed', 'aborted', 'cancelled'])
    .optional(),
  trigger: z.enum(['manual', 'api', 'schedule']).optional(),
  initiatedBy: z.string().uuid().optional(),
  /** Only runs queued within this window: a number and `m`, `h` or `d` (`24h`; Home links `/runs?since=24h`, #65). */
  since: z.string().regex(/^\d{1,4}[mhd]$/, 'Use a number and m, h or d (for example 24h)').optional(),
});

const SINCE_UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** The start of a `since` window (`24h`) before `now`. */
export function sinceToDate(since: string, now: number = Date.now()): Date {
  const amount = Number(since.slice(0, -1));
  const unit = since.slice(-1) as keyof typeof SINCE_UNIT_MS;
  return new Date(now - amount * SINCE_UNIT_MS[unit]);
}

export const retryRunSchema = z.object({ only: z.enum(['failed', 'all']).default('failed'), confirm: runConfirmSchema.optional() });

export const logQuerySchema = z.object({ tail: z.coerce.number().int().min(1).max(100_000).optional() });

export const approvalsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'all']).default('pending'),
  /** `true`: answer `{ count }` only (the Runbooks destination's badge, #65). */
  count: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const approvalDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  comment: z.string().trim().max(1000).optional(),
});

export class CreateRunDto extends createZodDto(createRunSchema) {}
export class RunsQueryDto extends createZodDto(runsQuerySchema) {}
export class RetryRunDto extends createZodDto(retryRunSchema) {}
export class LogQueryDto extends createZodDto(logQuerySchema) {}
export class ApprovalsQueryDto extends createZodDto(approvalsQuerySchema) {}
export class ApprovalDecisionDto extends createZodDto(approvalDecisionSchema) {}
