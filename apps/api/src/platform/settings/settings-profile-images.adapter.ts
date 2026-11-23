// =============================================================================
// The settings slice's SETTINGS_PROFILE_IMAGES port (issue #48)
// =============================================================================
//
// Normalising a stored `profile` is the platform's rule (`normalizeProfileSettings`):
// a row written with the legacy `useProviderImage` flag reads as `imageSource`
// `'provider'` (or `'none'` when the flag is false). The legacy `customImageUrl`
// is dropped on the first write.
//
// PLATFORM-ADOPTION-SHIM(#50): ShellKeep's own storage module does not write the
// platform's avatar objects (`avatars/<userId>/`, `purpose: 'avatar'`), so no
// uploaded avatar can exist and `isUploadedAvatar` answers false: a profile that
// selects `imageSource: 'upload'` is refused with a 400, as the platform does for
// an object the caller did not upload. #50 (the storage slice) binds the real
// check. See docs/platform-adoption/local-exceptions.md.
// =============================================================================

import { Injectable } from '@nestjs/common';
import type { NormalizedProfileSettings, SettingsProfileImages } from '@marinoscar/platform-api/settings';
import { normalizeProfileSettings } from '@marinoscar/platform-api/storage';

@Injectable()
export class ShellkeepSettingsProfileImages implements SettingsProfileImages {
  normalize(stored: unknown): NormalizedProfileSettings {
    return normalizeProfileSettings(stored);
  }

  async isUploadedAvatar(): Promise<boolean> {
    return false;
  }
}
