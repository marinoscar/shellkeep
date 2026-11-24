import { HttpException } from '@nestjs/common';

import { FILE_ERROR_CODES, type FileErrorCode } from './files.error-codes';

/** An HTTP error in the standard envelope (`{ code, message, details? }`) with the code's registered status. */
export function fileError(code: FileErrorCode, message: string, details?: Record<string, unknown>): HttpException {
  return new HttpException({ code, message, ...(details ? { details } : {}) }, FILE_ERROR_CODES[code].status);
}
