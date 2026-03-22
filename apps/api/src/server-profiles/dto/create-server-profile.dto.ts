import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createServerProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),
  hostname: z.string().min(1, 'Hostname is required').max(255, 'Hostname must be 255 characters or less'),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().min(1, 'Username is required').max(100, 'Username must be 100 characters or less'),
  authMethod: z.enum(['password', 'key', 'agent']),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
});

export class CreateServerProfileDto extends createZodDto(createServerProfileSchema) {}
