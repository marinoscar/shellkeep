import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { keyShortcutSchema } from '../../common/schemas/settings.schema';

// Full replacement (PUT)
export const updateUserSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  profile: z.object({
    displayName: z.string().max(100).optional(),
    useProviderImage: z.boolean(),
    customImageUrl: z.string().url().nullable().optional(),
  }),
  terminal: z
    .object({
      showScrollButtons: z.boolean(),
      keyShortcuts: z.array(keyShortcutSchema).max(50).optional(),
    })
    .optional(),
});

export class UpdateUserSettingsDto extends createZodDto(
  updateUserSettingsSchema,
) {}

// Partial update (PATCH) - JSON Merge Patch style
export const patchUserSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  profile: z
    .object({
      displayName: z.string().max(100).optional(),
      useProviderImage: z.boolean().optional(),
      customImageUrl: z.string().url().nullable().optional(),
    })
    .optional(),
  terminal: z
    .object({
      showScrollButtons: z.boolean().optional(),
      keyShortcuts: z.array(keyShortcutSchema).max(50).optional(),
    })
    .optional(),
});

export class PatchUserSettingsDto extends createZodDto(
  patchUserSettingsSchema,
) {}
