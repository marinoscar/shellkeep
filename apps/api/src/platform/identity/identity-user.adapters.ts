import { Injectable } from '@nestjs/common';
import type { IdentityProfileImages, UserDefaults } from '@marinoscar/platform-api/identity';
import { DEFAULT_USER_SETTINGS } from '@marinoscar/platform-api/settings';
import { normalizeProfileSettings, resolveProfileImageUrl } from '@marinoscar/platform-api/storage';

import { APP_USER_SETTINGS_INITIAL_VALUES } from '../../app-registrations/settings';

/**
 * Identity's `USER_DEFAULTS`: what a new user's `user_settings.value` holds at
 * creation, the platform's core fields plus the optional namespaces ShellKeep
 * starts every user with (`APP_USER_SETTINGS_INITIAL_VALUES`, #44, #48).
 */
@Injectable()
export class ShellkeepUserDefaults implements UserDefaults {
  userSettings(): Record<string, unknown> {
    // A fresh object per user: the document is stored and later mutated.
    return structuredClone({
      ...DEFAULT_USER_SETTINGS,
      ...APP_USER_SETTINGS_INITIAL_VALUES,
    }) as unknown as Record<string, unknown>;
  }
}

/**
 * Identity's `IDENTITY_PROFILE_IMAGES`: which picture `/api/auth/me` and
 * `/api/users` report, by the storage slice's single rule
 * (`resolveProfileImageUrl`): `none` hides it, `provider` shows the provider's,
 * `upload` shows the same-origin avatar URL of the user's uploaded object.
 *
 * Since #50 a stored `profile` that still carries ShellKeep's legacy
 * `customImageUrl` reads by the platform's rule, which ignores that key: a row
 * with `useProviderImage: false` shows no picture, as the platform reads it
 * (`imageSource: 'none'`).
 */
@Injectable()
export class ShellkeepProfileImages implements IdentityProfileImages {
  resolveImageUrl(
    user: { id: string; providerProfileImageUrl: string | null },
    profileSetting: unknown,
  ): string | null {
    return resolveProfileImageUrl(user, profileSetting);
  }

  hasUploadedImage(profileSetting: unknown): boolean {
    return normalizeProfileSettings(profileSetting).imageObjectId !== null;
  }
}
