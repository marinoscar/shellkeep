import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const serverProfilesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  /** `mine`: owned by me; `shared`: shared with me or owned by a group of mine; `all` (default): both. */
  filter: z.enum(['all', 'mine', 'shared']).default('all'),
});

export class ServerProfilesQueryDto extends createZodDto(serverProfilesQuerySchema) {}
