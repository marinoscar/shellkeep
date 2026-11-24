// =============================================================================
// The files API error codes (issue #153)
// =============================================================================
//
// Registered with the platform's error-code registry before it freezes (imported by
// `app-registrations/registrations.ts`). The filter passes a code through only for an
// exception of the registered status, so `files-errors.ts` throws each with its status.
// =============================================================================

import { registerErrorCode } from '@marinoscar/platform-api/core';

export const FILE_ERROR_CODES = {
  FILE_PATH_INVALID: { status: 400, description: 'The path is empty, too long, holds a NUL byte, or cannot be resolved.' },
  FILE_RANGE_INVALID: { status: 400, description: 'The offset or length of a ranged read is not valid for the file.' },
  FILE_NOT_A_FILE: { status: 400, description: 'The path is not a regular file (a directory or a special file).' },
  FILE_NOT_A_DIRECTORY: { status: 400, description: 'The path is not a directory.' },
  FILE_NAME_INVALID: { status: 400, description: 'The upload file name is empty, too long, "." or "..", or holds a slash or a control character.' },
  FILE_NOT_FOUND: { status: 404, description: 'Nothing exists at the path on the server.' },
  FILE_PERMISSION_DENIED: { status: 403, description: 'The server user may not read the path.' },
  FILE_DOWNLOAD_NOT_FOUND: { status: 404, description: 'The download token is unknown, expired or already used.' },
  FILE_EXISTS: { status: 409, description: 'A file with that name already exists in the target folder and overwrite was not requested.' },
  FILE_CHANGED: { status: 409, description: 'The file changed size after the download token was issued.' },
  FILE_TOO_LARGE: { status: 413, description: 'The file is larger than the configured cap for this operation.' },
  FILE_IS_BINARY: { status: 415, description: 'The file is binary (a NUL byte or invalid UTF-8 in its first 8 KB); download it instead.' },
  FILE_ARCHIVE_NOT_READY: { status: 409, description: 'The folder archive is still being built, or it failed; there is nothing to download.' },
  FILES_RATE_LIMITED: { status: 429, description: 'Too many file reads or downloads for this user; retry later.' },
  SFTP_UNAVAILABLE: { status: 502, description: 'The server refused the SFTP subsystem (disabled or not installed).' },
  SFTP_TIMEOUT: { status: 504, description: 'The server did not answer the SFTP request in time.' },
  SFTP_FAILED: { status: 502, description: 'The SFTP request failed on the server.' },
} as const;

export type FileErrorCode = keyof typeof FILE_ERROR_CODES;

let registered = false;

export function registerFileErrorCodes(): void {
  if (registered) return;
  registered = true;
  for (const [code, { status, description }] of Object.entries(FILE_ERROR_CODES)) {
    registerErrorCode({ code, status, description });
  }
}
