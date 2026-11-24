// =============================================================================
// Range math for ranged text reads (issue #153)
// =============================================================================

import { fileError } from './files-error';

export interface RangeLimits {
  /** A window (and a file shown whole) is at most this many bytes. */
  fullViewMaxBytes: number;
  /** The largest file the text viewer opens. */
  pagedViewMaxBytes: number;
}

export interface ByteRange {
  offset: number;
  /** Bytes to read; 0 for an empty read at the end of the file. */
  length: number;
}

/**
 * The window to read: `offset` defaults to 0 and must be inside the file; `length` defaults to
 * the full-view cap and is clamped to it and to the end of the file. A file above the paged cap
 * is refused (download only).
 */
export function computeRange(
  size: number,
  requested: { offset?: number; length?: number },
  limits: RangeLimits,
): ByteRange {
  const paged = Math.max(limits.pagedViewMaxBytes, limits.fullViewMaxBytes);
  if (size > paged) {
    throw fileError('FILE_TOO_LARGE', 'The file is too large to view as text; download it instead', {
      size,
      limit: paged,
    });
  }
  const offset = requested.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > size) {
    throw fileError('FILE_RANGE_INVALID', 'The offset is outside the file', { size });
  }
  if (requested.length !== undefined && (!Number.isSafeInteger(requested.length) || requested.length < 1)) {
    throw fileError('FILE_RANGE_INVALID', 'The length must be a positive integer');
  }
  const wanted = Math.min(requested.length ?? limits.fullViewMaxBytes, limits.fullViewMaxBytes);
  return { offset, length: Math.min(wanted, size - offset) };
}
