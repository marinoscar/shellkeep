// =============================================================================
// The files feature's import-time registrations (issue #158)
// =============================================================================
//
// The system access reason of the archive expiry sweep. Imported by `app-registrations/registrations.ts`
// (before the registries freeze). Idempotent per process.
// =============================================================================

import { registerSystemAccessReason } from '@marinoscar/platform-api/core';

import { FILES_ARCHIVE_PURGE_REASON } from './archive/archive.constants';

let registered = false;

export function registerFilesRegistrations(): void {
  if (registered) return;
  registered = true;
  registerSystemAccessReason({
    id: FILES_ARCHIVE_PURGE_REASON,
    description:
      'The folder archive expiry sweep (files.archive.purge) finds archives past their 24 hour life across every organization and deletes their stored objects and rows.',
  });
}
