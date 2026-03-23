import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const batchTerminateSessionsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
});

export class BatchTerminateSessionsDto extends createZodDto(batchTerminateSessionsSchema) {}
