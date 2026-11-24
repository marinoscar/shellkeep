import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { runConfirmSchema, strategyOverride } from '../../engine/dto/run.dto';
import { RUNBOOK_SECRET_NAME_PATTERN } from '../../runbooks.credentials';
import { targetSelectorSchema } from '../../schema/runbook-definition.schema';
import { OVERLAP_POLICIES } from '../schedules.constants';

const name = z.string().trim().min(1).max(120);
/** Whether a cron expression and a zone are valid is decided by the service (`RUNBOOK_SCHEDULE_INVALID`, with the reason). */
const cron = z.string().trim().min(1).max(120);
const timezone = z.string().trim().min(1).max(64);
/** `latest` (the runbook's newest version at every fire) or the id of one of its versions. */
const versionPin = z.union([z.literal('latest'), z.string().uuid()]);

export const createScheduleSchema = z.object({
  name,
  cron,
  timezone,
  versionPin: versionPin.default('latest'),
  params: z.record(z.string(), z.union([z.string().max(8192), z.number(), z.boolean()])).default({}),
  /** Secret parameter name to the name of a runbook secret. */
  secretRefs: z.record(z.string(), z.string().regex(RUNBOOK_SECRET_NAME_PATTERN)).default({}),
  /** Merged over the version's `defaultTargets` at every fire. */
  targets: targetSelectorSchema.partial().default({}),
  strategy: strategyOverride.optional(),
  overlap: z.enum(OVERLAP_POLICIES).default('skip'),
  enabled: z.boolean().default(true),
  /** Required to create a schedule of a destructive runbook (the exact name and the resolved server count). */
  confirm: runConfirmSchema.optional(),
});

export const updateScheduleSchema = z
  .object({
    name,
    cron,
    timezone,
    versionPin,
    params: z.record(z.string(), z.union([z.string().max(8192), z.number(), z.boolean()])),
    secretRefs: z.record(z.string(), z.string().regex(RUNBOOK_SECRET_NAME_PATTERN)),
    targets: targetSelectorSchema.partial(),
    /** `null` removes the override. */
    strategy: strategyOverride.nullable(),
    overlap: z.enum(OVERLAP_POLICIES),
    enabled: z.boolean(),
    confirm: runConfirmSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });

export const schedulesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const previewQuerySchema = z.object({
  cron,
  timezone: timezone.default('UTC'),
});

export const approveScheduleSchema = z.object({ comment: z.string().trim().max(1000).optional() });

export class CreateScheduleDto extends createZodDto(createScheduleSchema) {}
export class UpdateScheduleDto extends createZodDto(updateScheduleSchema) {}
export class SchedulesQueryDto extends createZodDto(schedulesQuerySchema) {}
export class PreviewQueryDto extends createZodDto(previewQuerySchema) {}
export class ApproveScheduleDto extends createZodDto(approveScheduleSchema) {}
