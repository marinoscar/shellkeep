/**
 * The `files` system-settings namespace, web half (issue #153, epic #151).
 *
 * Mirrors `apps/api/src/files/settings/files.system-settings.ts`: the size caps
 * and per-user rate limits of the files API. The API validates every field's
 * bounds; these copies only let the admin page refuse a bad value before it is
 * sent.
 *
 * The ordering rule (full view <= paged view <= download) is NOT in the API's
 * Zod schema: the API tolerates an inverted pair (`range.ts` takes the larger of
 * the two view caps). The page enforces it so an administrator cannot store a
 * combination that makes no sense.
 */

/** The namespace's key in the system settings document. */
export const FILES_SYSTEM_SETTINGS_KEY = 'files';

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

export type FilesSystemField = keyof FilesSystemSettings;

/** The fields measured in bytes. */
export type FilesByteField = 'fullViewMaxBytes' | 'pagedViewMaxBytes' | 'downloadMaxBytes' | 'uploadMaxBytes';
/** The fields that are plain counts (seconds, requests, streams). */
export type FilesCountField = Exclude<FilesSystemField, FilesByteField>;

export const BYTE_FIELDS: readonly FilesByteField[] = [
  'fullViewMaxBytes',
  'pagedViewMaxBytes',
  'downloadMaxBytes',
  'uploadMaxBytes',
];
export const COUNT_FIELDS: readonly FilesCountField[] = [
  'sftpTimeoutSeconds',
  'contentRequestsPerMinute',
  'downloadsPerMinute',
  'maxConcurrentDownloads',
];

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

/** Inclusive bounds; the same as the API's `FILES_SYSTEM_BOUNDS`. */
export const FILES_SYSTEM_BOUNDS: Record<FilesSystemField, { min: number; max: number }> = {
  fullViewMaxBytes: { min: 64 * KB, max: 16 * MB },
  pagedViewMaxBytes: { min: MB, max: 2 * GB },
  downloadMaxBytes: { min: MB, max: 20 * GB },
  uploadMaxBytes: { min: MB, max: 2 * GB },
  sftpTimeoutSeconds: { min: 5, max: 300 },
  contentRequestsPerMinute: { min: 1, max: 6000 },
  downloadsPerMinute: { min: 1, max: 600 },
  maxConcurrentDownloads: { min: 1, max: 50 },
};

/** The API's defaults, used while the namespace is absent from the document. */
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

/** The system settings document, as far as this page reads it. */
export interface FilesSystemSettingsDocument {
  version: number;
  files?: Partial<FilesSystemSettings> | null;
}

/** The namespace from a document, with the defaults filled in. */
export function readFilesSystemSettings(document: FilesSystemSettingsDocument | null): FilesSystemSettings {
  return { ...DEFAULT_FILES_SYSTEM_SETTINGS, ...(document?.files ?? {}) };
}

/** A size unit the page offers, largest last. */
export type ByteUnit = 'B' | 'KB' | 'MB' | 'GB';
export const BYTE_UNITS: readonly ByteUnit[] = ['B', 'KB', 'MB', 'GB'];
export const BYTES_PER_UNIT: Record<ByteUnit, number> = { B: 1, KB, MB, GB };

/** A byte count as the largest unit that holds it exactly (2097152 is 2 MB). */
export function splitBytes(bytes: number): { amount: string; unit: ByteUnit } {
  for (const unit of [...BYTE_UNITS].reverse()) {
    if (bytes > 0 && bytes % BYTES_PER_UNIT[unit] === 0) {
      return { amount: String(bytes / BYTES_PER_UNIT[unit]), unit };
    }
  }
  return { amount: String(bytes), unit: 'B' };
}

/** A byte count for display: `2 MB`, `64 KB`, `1536 KB`. */
export function formatBytes(bytes: number): string {
  const { amount, unit } = splitBytes(bytes);
  return `${amount} ${unit}`;
}

/** A raw input as a positive whole number, or `null`. */
function positiveInteger(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** The byte count of an amount and unit, or `null` when the amount is not a positive whole number. */
export function toBytes(amount: string, unit: ByteUnit): number | null {
  const value = positiveInteger(amount);
  return value === null ? null : value * BYTES_PER_UNIT[unit];
}

/** The error for one byte field, or `null` when it is a positive whole amount within the bounds. */
export function byteFieldError(field: FilesByteField, amount: string, unit: ByteUnit): string | null {
  const bytes = toBytes(amount, unit);
  if (bytes === null) return 'Enter a whole number greater than 0.';
  const { min, max } = FILES_SYSTEM_BOUNDS[field];
  if (bytes < min || bytes > max) {
    return `Enter a size from ${formatBytes(min)} to ${formatBytes(max)}.`;
  }
  return null;
}

/** The error for one count field, or `null` when it is a whole number within the bounds. */
export function countFieldError(field: FilesCountField, raw: string): string | null {
  const { min, max } = FILES_SYSTEM_BOUNDS[field];
  const value = positiveInteger(raw);
  if (value === null || value < min || value > max) {
    return `Enter a whole number from ${min} to ${max}.`;
  }
  return null;
}

/**
 * The ordering errors, keyed by the field to flag: the full-view cap must not
 * exceed the paged cap, and the paged cap must not exceed the download cap.
 * Fields whose value is unknown (invalid input) are skipped.
 */
export function orderingErrors(
  sizes: Partial<Record<FilesByteField, number | null>>,
): Partial<Record<FilesByteField, string>> {
  const errors: Partial<Record<FilesByteField, string>> = {};
  const { fullViewMaxBytes: full, pagedViewMaxBytes: paged, downloadMaxBytes: download } = sizes;
  if (full != null && paged != null && full > paged) {
    errors.fullViewMaxBytes = 'Must not be larger than the paged view limit.';
  }
  if (paged != null && download != null && paged > download) {
    errors.pagedViewMaxBytes = 'Must not be larger than the download limit.';
  }
  return errors;
}
