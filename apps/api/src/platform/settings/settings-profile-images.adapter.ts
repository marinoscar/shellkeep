// =============================================================================
// The settings slice's SETTINGS_PROFILE_IMAGES port (issues #48, #50)
// =============================================================================
//
// Normalising a stored `profile` is the platform's rule (`normalizeProfileSettings`):
// a row written with the legacy `useProviderImage` flag reads as `imageSource`
// `'provider'` (or `'none'` when the flag is false). The legacy `customImageUrl`
// is dropped on the first write.
//
// `isUploadedAvatar` is the platform's check (`isAvatarObjectFor`) on the object
// the caller named: uploaded by that user, under `avatars/<userId>/`, with
// `purpose: 'avatar'`, `ready` and an image type. The read crosses nothing the
// caller does not own, but `PATCH /api/user-settings` carries no organization
// scope the object could be matched against, so the read uses the slice's bypass
// client (`STORAGE_SYSTEM_DATA`) under the registered `admin-aggregate` reason.
// =============================================================================

import { Inject, Injectable } from '@nestjs/common';
import type { NormalizedProfileSettings, SettingsProfileImages } from '@marinoscar/platform-api/settings';
import {
  STORAGE_SYSTEM_DATA,
  isAvatarObjectFor,
  normalizeProfileSettings,
  type StorageSystemData,
} from '@marinoscar/platform-api/storage';

@Injectable()
export class ShellkeepSettingsProfileImages implements SettingsProfileImages {
  constructor(@Inject(STORAGE_SYSTEM_DATA) private readonly system: StorageSystemData) {}

  normalize(stored: unknown): NormalizedProfileSettings {
    return normalizeProfileSettings(stored);
  }

  async isUploadedAvatar(userId: string, objectId: string): Promise<boolean> {
    const object = await this.system.asSystem('admin-aggregate').storageObject.findUnique({
      where: { id: objectId },
      select: {
        uploadedById: true,
        storageKey: true,
        status: true,
        mimeType: true,
        metadata: true,
      },
    });

    return isAvatarObjectFor(object, userId);
  }
}
