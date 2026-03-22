import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const serverProfilesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

export class ServerProfilesQueryDto extends createZodDto(serverProfilesQuerySchema) {}
