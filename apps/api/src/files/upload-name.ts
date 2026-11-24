// =============================================================================
// The file name of an upload (issue #157)
// =============================================================================
//
// The name becomes ONE path segment (the target directory is a separate field), so it may not
// hold a separator, a NUL byte or a control character, and it may not be `.` or `..`. The limit
// leaves room for the temporary name (`.<name>.shellkeep-upload-<12 hex>`) inside the 255 bytes
// most file systems allow for one segment.
// =============================================================================

import { fileError } from './files-error';

export const MAX_UPLOAD_NAME_BYTES = 200;

/** Why a name is refused, or null when it is a valid single path segment. */
export function uploadNameProblem(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0) return 'The file name is empty';
  if (name === '.' || name === '..') return 'The file name may not be "." or ".."';
  if (name.includes('/')) return 'The file name may not contain "/"';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return 'The file name may not contain control characters';
  if (Buffer.byteLength(name, 'utf8') > MAX_UPLOAD_NAME_BYTES) return `The file name is longer than ${MAX_UPLOAD_NAME_BYTES} bytes`;
  return null;
}

/** Throws `FILE_NAME_INVALID` (400) for a name that is not a safe single path segment. */
export function assertUploadName(name: unknown): asserts name is string {
  const problem = uploadNameProblem(name);
  if (problem) throw fileError('FILE_NAME_INVALID', problem);
}

/** The temporary name an upload streams into, in the target's own directory. */
export function uploadTempName(name: string, random: string): string {
  return `.${name}.shellkeep-upload-${random}`;
}
