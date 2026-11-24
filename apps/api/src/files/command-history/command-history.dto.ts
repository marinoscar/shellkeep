import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { MAX_HISTORY_ENTRIES } from './history-parse';

export const commandHistoryQuerySchema = z.object({
  /** A case-insensitive substring of the (already redacted) command. */
  query: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_HISTORY_ENTRIES).default(200),
});

export class CommandHistoryQueryDto extends createZodDto(commandHistoryQuerySchema) {}
