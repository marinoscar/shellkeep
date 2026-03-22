import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const updateSessionSchema = z.object({
  name: z.string().min(1).max(100),
});

export class UpdateSessionDto extends createZodDto(updateSessionSchema) {}
