import { Injectable } from '@nestjs/common';
import type { IdentityProfileImages, UserDefaults } from '@marinoscar/platform-api/identity';

import { DEFAULT_USER_SETTINGS } from '../../common/types/settings.types';

/**
 * Identity's `USER_DEFAULTS`: what a new user's `user_settings.value` holds at
 * creation, the composed defaults of ShellKeep's own settings module (the core
 * fields plus every user-settings namespace the domain registers, #44).
 */
@Injectable()
export class ShellkeepUserDefaults implements UserDefaults {
  userSettings(): Record<string, unknown> {
    // A fresh object per user: the document is stored and later mutated.
    return structuredClone(DEFAULT_USER_SETTINGS) as unknown as Record<string, unknown>;
  }
}

interface StoredProfile {
  useProviderImage?: unknown;
  customImageUrl?: unknown;
}

function storedProfile(value: unknown): StoredProfile {
  return value !== null && typeof value === 'object' ? (value as StoredProfile) : {};
}

/**
 * Identity's `IDENTITY_PROFILE_IMAGES`: which picture `/api/auth/me` and
 * `/api/users` report, read from the stored `profile` user setting as ShellKeep
 * always has: the custom image when the user opted out of the provider's picture
 * and set one, otherwise the provider's.
 *
 * PLATFORM-ADOPTION-SHIM(#50): the platform's picture rule reads
 * `profile.imageSource` and an uploaded storage object, which ShellKeep's
 * settings and storage modules do not write until #48 and #50. #50 binds the
 * storage slice's `resolveProfileImageUrl`. See
 * docs/platform-adoption/local-exceptions.md.
 */
@Injectable()
export class ShellkeepProfileImages implements IdentityProfileImages {
  resolveImageUrl(
    user: { id: string; providerProfileImageUrl: string | null },
    profileSetting: unknown,
  ): string | null {
    const profile = storedProfile(profileSetting);
    if (profile.useProviderImage === false && typeof profile.customImageUrl === 'string' && profile.customImageUrl) {
      return profile.customImageUrl;
    }
    return user.providerProfileImageUrl;
  }

  hasUploadedImage(profileSetting: unknown): boolean {
    const url = storedProfile(profileSetting).customImageUrl;
    return typeof url === 'string' && url.length > 0;
  }
}
