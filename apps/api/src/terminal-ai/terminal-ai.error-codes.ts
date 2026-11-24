// The terminal AI error codes (issue #56). Registered with the platform's error-code registry
// at import time (before it freezes at bootstrap); imported by `app-registrations/registrations.ts`.

import { registerErrorCode } from '@marinoscar/platform-api/core';

export const AI_CONSENT_REQUIRED = 'AI_CONSENT_REQUIRED';
export const AI_OUTPUT_SHARING_DISABLED = 'AI_OUTPUT_SHARING_DISABLED';
/** Command assist (#57): the model's answer had no usable `COMMAND:` line. Sent as an in-band SSE `error`. */
export const AI_ASSIST_UNPARSEABLE = 'AI_ASSIST_UNPARSEABLE';
/** Explain (#58): the model's answer was empty. Sent as an in-band SSE `error`. */
export const AI_EXPLAIN_EMPTY = 'AI_EXPLAIN_EMPTY';

/** Session summaries (#59): the session has ended, so there is nothing left to summarize. */
export const SESSION_TERMINATED = 'SESSION_TERMINATED';

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
  registerErrorCode({
    code: AI_EXPLAIN_EMPTY,
    status: 502,
    description: 'The AI answer to an explain request was empty.',
  });
  registerErrorCode({
    code: SESSION_TERMINATED,
    status: 400,
    description: 'The terminal session has been terminated, so it cannot be summarized.',
  });
}
