/**
 * Object storage from the web app (issue #50): the platform's objects client
 * (`@marinoscar/platform-web/storage/headless`) over the app's transport, and
 * the one ShellKeep flow that uses it, pasting a clipboard image into a
 * terminal as a signed download URL.
 *
 * The object routes need `storage:read` / `storage:write` and answer `503`
 * (`details.reason: 'storage_not_configured'`) until an administrator
 * configures storage at Settings → Storage; {@link storageErrorMessage} turns
 * those answers into a sentence a user can act on.
 */

import {
  StorageObjectNotReadyError,
  createStorageObjectsClient,
} from '@marinoscar/platform-web/storage/headless';
import { isPlatformApiError } from '@marinoscar/platform-web/core';
import { platformApi } from './api';

/** The storage objects client. A module constant: built once over the app's client. */
export const storageObjects = createStorageObjectsClient(platformApi);

/**
 * Uploads a pasted image, waits until the API has processed it and returns a
 * time-limited signed URL to it.
 *
 * @param file - the image.
 * @param filename - the name to store it under.
 * @returns the signed download URL.
 */
export async function uploadPastedImage(file: Blob, filename: string): Promise<string> {
  const object = await storageObjects.uploadAndWait(file, { filename });
  const { url } = await storageObjects.downloadUrl(object.id);
  return url;
}

/**
 * A user-facing message for a failed storage call.
 *
 * @param error - what the call threw.
 * @param fallback - the message when nothing more specific applies.
 * @returns the message.
 */
export function storageErrorMessage(error: unknown, fallback: string): string {
  // The objects client rejects with the platform's `PlatformApiError` shape.
  if (isPlatformApiError(error)) {
    if (error.status === 503) {
      return 'File storage is not configured yet. An administrator can set it up under Settings → Storage.';
    }
    if (error.status === 403) {
      return 'You do not have permission to upload files.';
    }
  }
  if (error instanceof StorageObjectNotReadyError) return error.message;
  if (isPlatformApiError(error)) return error.message || fallback;
  return error instanceof Error && error.message ? error.message : fallback;
}
