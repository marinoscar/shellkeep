import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { targetSelectorSchema } from '../schema/runbook-definition.schema';
import { RUNBOOK_SECRET_NAME_PATTERN } from '../runbooks.credentials';

/**
 * The definition travels as an opaque object here and is validated by the service against
 * `runbookDefinitionSchema`, so a bad definition answers `422 RUNBOOK_DEFINITION_INVALID` with
 * issue paths rather than the generic request-validation error.
 */
const definitionBody = z
  .record(z.string(), z.unknown())
  .describe('A runbook definition (see runbookDefinitionSchema): schemaVersion, parameters, steps, defaultTargets, strategy.');

const nameField = z.string().trim().min(1).max(120);
const tagsField = z.array(z.string().trim().min(1).max(50)).max(20);

export const createRunbookSchema = z.object({
  name: nameField,
  description: z.string().max(5000).optional(),
  tags: tagsField.optional(),
  definition: definitionBody,
  changelog: z.string().max(500).optional(),
});

export const replaceDefinitionSchema = z.object({
  definition: definitionBody,
  changelog: z.string().max(500).optional(),
});

export const updateRunbookMetadataSchema = z
  .object({
    name: nameField.optional(),
    description: z.string().max(5000).nullable().optional(),
    tags: tagsField.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const validateDefinitionSchema = z.object({ definition: definitionBody });

export const runbooksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).max(120).optional(),
  tag: z.string().trim().min(1).max(50).optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const versionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const previewTargetsSchema = z.object({ selector: targetSelectorSchema });

export const setRunbookSecretSchema = z.object({
  value: z.string().min(1).max(8192),
  label: z.string().trim().max(120).optional(),
});

export const runbookSecretNameSchema = z.string().regex(RUNBOOK_SECRET_NAME_PATTERN, 'Use lower-case letters, digits, "_" or "-", starting with a letter (max 64)');

export class CreateRunbookDto extends createZodDto(createRunbookSchema) {}
export class ReplaceDefinitionDto extends createZodDto(replaceDefinitionSchema) {}
export class UpdateRunbookMetadataDto extends createZodDto(updateRunbookMetadataSchema) {}
export class ValidateDefinitionDto extends createZodDto(validateDefinitionSchema) {}
export class RunbooksQueryDto extends createZodDto(runbooksQuerySchema) {}
export class VersionsQueryDto extends createZodDto(versionsQuerySchema) {}
export class PreviewTargetsDto extends createZodDto(previewTargetsSchema) {}
export class SetRunbookSecretDto extends createZodDto(setRunbookSecretSchema) {}
