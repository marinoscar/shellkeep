import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createSessionSchema = z.object({
  serverProfileId: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
});

export class CreateSessionDto extends createZodDto(createSessionSchema) {}
