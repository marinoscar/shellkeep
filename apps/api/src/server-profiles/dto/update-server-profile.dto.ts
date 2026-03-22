import { createZodDto } from 'nestjs-zod';
import { createServerProfileSchema } from './create-server-profile.dto';

export const updateServerProfileSchema = createServerProfileSchema.partial();

export class UpdateServerProfileDto extends createZodDto(updateServerProfileSchema) {}
