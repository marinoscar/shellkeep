import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { createServerProfileSchema } from './create-server-profile.dto';

/**
 * Every field optional, and NO default: `.partial()` alone keeps the create schema's
 * defaults, so an update that names only `name` would silently reset `port` to 22 (and
 * `tags`, `color`), which also clears the trusted host key of a profile whose endpoint
 * did not change (#60).
 */
export const updateServerProfileSchema = createServerProfileSchema
  // The owner is chosen at creation; moving a profile between owners is not an update.
  .omit({ ownerGroupId: true })
  .extend({
    port: createServerProfileSchema.shape.port.removeDefault(),
    tags: z.array(z.string()).optional(),
    color: createServerProfileSchema.shape.color.removeDefault(),
  })
  .partial();

export class UpdateServerProfileDto extends createZodDto(updateServerProfileSchema) {}
