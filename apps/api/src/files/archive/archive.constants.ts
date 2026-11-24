// =============================================================================
// Folder archives (issue #158, epic #151): names and limits
// =============================================================================

/** The archive job. PERMANENT once jobs of this type exist. Server-only: it holds an SSH connection. */
export const FILES_ARCHIVE_JOB_TYPE = 'files.archive';
/** The expiry sweep job (a system job queued by the enqueue-only cron). PERMANENT. */
export const FILES_ARCHIVE_PURGE_JOB_TYPE = 'files.archive.purge';
/** The `jobs.reason` of both (registered in `app-registrations/jobs.ts`). */
export const FILES_ARCHIVE_JOB_REASON = 'files_archive';
/** `jobs.subject_type` of an archive job; the subject id is the archive id. */
export const FILES_ARCHIVE_SUBJECT = 'file_archive';
/** The system access reason of the expiry sweep (registered by `files.registrations.ts`). */
export const FILES_ARCHIVE_PURGE_REASON = 'files-archive-purge';
/** The object-key prefix id registered in `app-registrations/storage-prefixes.ts`. */
export const FILE_ARCHIVES_KEY_PREFIX = 'file-archives';

/** An archive (ready or not) is deleted this long after it was requested; a ready one is renewed to this from when it became ready. */
export const ARCHIVE_TTL_MS = 24 * 60 * 60 * 1000;
/** How long a presigned download link works. */
export const ARCHIVE_DOWNLOAD_URL_TTL_SEC = 15 * 60;
/** The job's own deadline: a minute under `profile.maxRuntimeMs`, so the handler fails with a reason before the lease would. */
export const ARCHIVE_MAX_RUNTIME_MS = 30 * 60_000;
export const ARCHIVE_DEADLINE_MS = ARCHIVE_MAX_RUNTIME_MS - 60_000;

export const ARCHIVE_STATUSES = ['pending', 'running', 'ready', 'failed'] as const;
export type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];

/** Failure codes stored on the row (`error_code`); the message is what the person sees. */
export const ARCHIVE_FAILURE = {
  TOO_LARGE: 'ARCHIVE_TOO_LARGE',
  TAR_FAILED: 'ARCHIVE_TAR_FAILED',
  ACCESS_LOST: 'ARCHIVE_ACCESS_LOST',
  HOST_KEY: 'ARCHIVE_HOST_KEY',
  CONNECT_FAILED: 'ARCHIVE_CONNECT_FAILED',
  TIMEOUT: 'ARCHIVE_TIMEOUT',
  STORAGE_FAILED: 'ARCHIVE_STORAGE_FAILED',
  INTERNAL: 'ARCHIVE_FAILED',
} as const;
export type ArchiveFailureCode = (typeof ARCHIVE_FAILURE)[keyof typeof ARCHIVE_FAILURE];
