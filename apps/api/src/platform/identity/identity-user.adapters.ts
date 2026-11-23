import { Injectable } from '@nestjs/common';
import type { IdentityProfileImages, UserDefaults } from '@marinoscar/platform-api/identity';
import { DEFAULT_USER_SETTINGS } from '@marinoscar/platform-api/settings';

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

interface StoredProfile {
  imageSource?: unknown;
  useProviderImage?: unknown;
  customImageUrl?: unknown;
}

function storedProfile(value: unknown): StoredProfile {
  return value !== null && typeof value === 'object' ? (value as StoredProfile) : {};
}

/**
 * Identity's `IDENTITY_PROFILE_IMAGES`: which picture `/api/auth/me` and
 * `/api/users` report, read from the stored `profile` user setting. A profile
 * written by the platform settings slice (#48) carries `imageSource`: `none`
 * hides the picture, anything else shows the provider's. A legacy profile
 * (`useProviderImage`, `customImageUrl`) reads as ShellKeep always has: the
 * custom image when the user opted out of the provider's picture and set one,
 * otherwise the provider's.
 *
 * PLATFORM-ADOPTION-SHIM(#50): the platform's picture rule also serves an
 * uploaded avatar object, which ShellKeep's storage module does not write.
 * #50 binds the storage slice's `resolveProfileImageUrl`. See
 * docs/platform-adoption/local-exceptions.md.
 */
@Injectable()
export class ShellkeepProfileImages implements IdentityProfileImages {
  resolveImageUrl(
    user: { id: string; providerProfileImageUrl: string | null },
    profileSetting: unknown,
  ): string | null {
    const profile = storedProfile(profileSetting);
    if (profile.imageSource === 'none') return null;
    if (
      profile.imageSource === undefined &&
      profile.useProviderImage === false &&
      typeof profile.customImageUrl === 'string' &&
      profile.customImageUrl
    ) {
      return profile.customImageUrl;
    }
    return user.providerProfileImageUrl;
  }

  hasUploadedImage(profileSetting: unknown): boolean {
    const url = storedProfile(profileSetting).customImageUrl;
    return typeof url === 'string' && url.length > 0;
  }
}
