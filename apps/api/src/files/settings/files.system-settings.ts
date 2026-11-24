// =============================================================================
// The `files` system-settings namespace (issue #153, epic #151)
// =============================================================================
//
// The `files` key of the `global` row of `system_settings`: the size guardrails and
// the per-user rate limits of the files API (`src/files/`). Read on every request, so
// a change applies without a deploy.
//
//   fullViewMaxBytes        a text window (and a file shown whole) is at most this
//   pagedViewMaxBytes       the largest file the text viewer opens; above it, download only
//   downloadMaxBytes        the largest file a download token is issued for
//   uploadMaxBytes          the largest upload (used by the upload issue, #157)
//   sftpTimeoutSeconds      a read gives up after this long (idle time for a download)
//   contentRequestsPerMinute  per user, `GET .../files/content`
//   downloadsPerMinute        per user, download tokens issued
//   maxConcurrentDownloads    per user, streams open at once
//
// No secret lives here.
// =============================================================================

import { z } from 'zod';
import type { SystemSettingsNamespace } from '@marinoscar/platform-api/settings';

export const FILES_SYSTEM_SETTINGS_KEY = 'files';

const MB = 1024 * 1024;
const GB = 1024 * MB;

export interface FilesSystemSettings {
  fullViewMaxBytes: number;
  pagedViewMaxBytes: number;
  downloadMaxBytes: number;
  uploadMaxBytes: number;
  sftpTimeoutSeconds: number;
  contentRequestsPerMinute: number;
  downloadsPerMinute: number;
  maxConcurrentDownloads: number;
}

export type FilesSystemSettingsPatch = Partial<FilesSystemSettings>;

export const FILES_SYSTEM_BOUNDS = {
  fullViewMaxBytes: { min: 64 * 1024, max: 16 * MB },
  pagedViewMaxBytes: { min: MB, max: 2 * GB },
  downloadMaxBytes: { min: MB, max: 20 * GB },
  uploadMaxBytes: { min: MB, max: 2 * GB },
  sftpTimeoutSeconds: { min: 5, max: 300 },
  contentRequestsPerMinute: { min: 1, max: 6000 },
  downloadsPerMinute: { min: 1, max: 600 },
  maxConcurrentDownloads: { min: 1, max: 50 },
} as const;

const bounded = (field: keyof typeof FILES_SYSTEM_BOUNDS) =>
  z.number().int().min(FILES_SYSTEM_BOUNDS[field].min).max(FILES_SYSTEM_BOUNDS[field].max);

export const filesSystemSettingsSchema = z.object({
  fullViewMaxBytes: bounded('fullViewMaxBytes'),
  pagedViewMaxBytes: bounded('pagedViewMaxBytes'),
  downloadMaxBytes: bounded('downloadMaxBytes'),
  uploadMaxBytes: bounded('uploadMaxBytes'),
  sftpTimeoutSeconds: bounded('sftpTimeoutSeconds'),
  contentRequestsPerMinute: bounded('contentRequestsPerMinute'),
  downloadsPerMinute: bounded('downloadsPerMinute'),
  maxConcurrentDownloads: bounded('maxConcurrentDownloads'),
});

export const filesSystemSettingsPatchSchema = filesSystemSettingsSchema.partial();

export const DEFAULT_FILES_SYSTEM_SETTINGS: FilesSystemSettings = {
  fullViewMaxBytes: 2 * MB,
  pagedViewMaxBytes: 200 * MB,
  downloadMaxBytes: 2 * GB,
  uploadMaxBytes: 100 * MB,
  sftpTimeoutSeconds: 30,
  contentRequestsPerMinute: 120,
  downloadsPerMinute: 20,
  maxConcurrentDownloads: 3,
};

export const FILES_SYSTEM_SETTINGS: SystemSettingsNamespace<
  typeof FILES_SYSTEM_SETTINGS_KEY,
  FilesSystemSettings,
  FilesSystemSettingsPatch
> = {
  key: FILES_SYSTEM_SETTINGS_KEY,
  description:
    'Files over SFTP: text view, paged view, download and upload size caps, the read timeout and the per-user rate limits.',
  storedSchema: filesSystemSettingsSchema,
  patchSchema: filesSystemSettingsPatchSchema,
  putSchema: filesSystemSettingsSchema,
  wirePatchSchema: filesSystemSettingsPatchSchema,
  responseSchema: filesSystemSettingsSchema,
  defaults: DEFAULT_FILES_SYSTEM_SETTINGS,
  // A PUT that omits the namespace keeps the stored value, as every optional namespace does.
  requiredOnPut: false,
  read: (stored, helpers) =>
    helpers.readNamespace(
      stored,
      filesSystemSettingsSchema,
      DEFAULT_FILES_SYSTEM_SETTINGS as unknown as Record<string, unknown>,
    ) as unknown as FilesSystemSettings,
  merge: (current, patch) => ({
    fullViewMaxBytes: patch?.fullViewMaxBytes ?? current.fullViewMaxBytes,
    pagedViewMaxBytes: patch?.pagedViewMaxBytes ?? current.pagedViewMaxBytes,
    downloadMaxBytes: patch?.downloadMaxBytes ?? current.downloadMaxBytes,
    uploadMaxBytes: patch?.uploadMaxBytes ?? current.uploadMaxBytes,
    sftpTimeoutSeconds: patch?.sftpTimeoutSeconds ?? current.sftpTimeoutSeconds,
    contentRequestsPerMinute: patch?.contentRequestsPerMinute ?? current.contentRequestsPerMinute,
    downloadsPerMinute: patch?.downloadsPerMinute ?? current.downloadsPerMinute,
    maxConcurrentDownloads: patch?.maxConcurrentDownloads ?? current.maxConcurrentDownloads,
  }),
};

declare module '@marinoscar/platform-api/settings' {
  interface SystemSettingsNamespaces {
    files: FilesSystemSettings;
  }

  interface SystemSettingsNamespaceDeclarations {
    files: typeof FILES_SYSTEM_SETTINGS;
  }
}
