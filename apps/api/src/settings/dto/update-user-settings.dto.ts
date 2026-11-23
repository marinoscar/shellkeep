import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  composeUserSettingsPatchSchema,
  composeUserSettingsSchema,
} from '../registry/user-settings-namespaces';
import type { UserSettingsValue } from '../../common/types/settings.types';

// Both schemas are composed from the user-settings namespace registry when this
// module is first evaluated, so `shellkeep.manifest` must be imported before it.

/** PATCH body: every core field optional, namespaces as registered. */
export type PatchUserSettingsValue = {
  theme?: UserSettingsValue['theme'];
  profile?: Partial<UserSettingsValue['profile']>;
} & { [key: string]: unknown };

// Full replacement (PUT); also the validation schema of the stored value
export const updateUserSettingsSchema = composeUserSettingsSchema() as unknown as z.ZodType<UserSettingsValue>;

export class UpdateUserSettingsDto extends createZodDto(
  updateUserSettingsSchema,
) {}

// Partial update (PATCH) - JSON Merge Patch style
export const patchUserSettingsSchema = composeUserSettingsPatchSchema() as unknown as z.ZodType<PatchUserSettingsValue>;

export class PatchUserSettingsDto extends createZodDto(
  patchUserSettingsSchema,
) {}
