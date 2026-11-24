// The terminal AI error codes (issue #56). Registered with the platform's error-code registry
// at import time (before it freezes at bootstrap); imported by `app-registrations/registrations.ts`.

import { registerErrorCode } from '@marinoscar/platform-api/core';

export const AI_CONSENT_REQUIRED = 'AI_CONSENT_REQUIRED';
export const AI_OUTPUT_SHARING_DISABLED = 'AI_OUTPUT_SHARING_DISABLED';
/** Command assist (#57): the model's answer had no usable `COMMAND:` line. Sent as an in-band SSE `error`. */
export const AI_ASSIST_UNPARSEABLE = 'AI_ASSIST_UNPARSEABLE';

let registered = false;

export function registerTerminalAiErrorCodes(): void {
  if (registered) return;
  registered = true;
  registerErrorCode({
    code: AI_CONSENT_REQUIRED,
    status: 409,
    description: 'The user has not yet accepted that redacted terminal output may be sent to AI.',
  });
  registerErrorCode({
    code: AI_OUTPUT_SHARING_DISABLED,
    status: 409,
    description: 'This server profile never shares terminal output with AI features.',
  });
  registerErrorCode({
    code: AI_ASSIST_UNPARSEABLE,
    status: 502,
    description: 'The AI answer to a command-assist request could not be read as a single command.',
  });
}
