// =============================================================================
// The snippets API error codes (issue #172)
// =============================================================================
//
// Registered with the platform's error-code registry before it freezes (imported by
// `app-registrations/registrations.ts`).
// =============================================================================

import { HttpException } from '@nestjs/common';
import { registerErrorCode } from '@marinoscar/platform-api/core';

export const SNIPPET_ERROR_CODES = {
  SNIPPET_LIMIT_REACHED: { status: 409, description: 'The user already keeps the maximum number of snippets.' },
  SNIPPET_ORDER_INVALID: { status: 400, description: 'The order list names a snippet twice.' },
  SNIPPETS_RATE_LIMITED: { status: 429, description: 'Too many snippet requests for this user; retry later.' },
} as const;

export type SnippetErrorCode = keyof typeof SNIPPET_ERROR_CODES;

/** An HTTP error in the standard envelope with the code's registered status. */
export function snippetError(code: SnippetErrorCode, message: string, details?: Record<string, unknown>): HttpException {
  return new HttpException({ code, message, ...(details ? { details } : {}) }, SNIPPET_ERROR_CODES[code].status);
}

let registered = false;

export function registerSnippetErrorCodes(): void {
  if (registered) return;
  registered = true;
  for (const [code, { status, description }] of Object.entries(SNIPPET_ERROR_CODES)) {
    registerErrorCode({ code, status, description });
  }
}
