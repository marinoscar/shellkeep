import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const sessionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(20).optional(),
  status: z.enum(['active', 'detached', 'terminated', 'all']).default('all').optional(),
});

export class SessionQueryDto extends createZodDto(sessionQuerySchema) {}
