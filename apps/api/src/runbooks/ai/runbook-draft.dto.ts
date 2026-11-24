import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const draftRunbookSchema = z.object({
  /** What the runbook should do, in plain language. */
  prompt: z.string().trim().min(1).max(4000),
  /** Servers the runbook is for: their facts (never terminal output) are given to the model as context. */
  targetHint: z
    .object({
      serverIds: z.array(z.string().uuid()).max(20).optional(),
      tags: z.array(z.string().min(1).max(64)).max(20).optional(),
    })
    .optional(),
});
export class DraftRunbookDto extends createZodDto(draftRunbookSchema) {}
