// =============================================================================
// The SSH error codes (issue #60)
// =============================================================================
//
// Registered with the platform's error-code registry at import time (before the
// registry freezes at bootstrap). The filter passes a code through only for an
// exception of the registered status. Imported by `app-registrations/registrations.ts`.
// =============================================================================

import { registerErrorCode } from '@marinoscar/platform-api/core';

let registered = false;

export function registerSshErrorCodes(): void {
  if (registered) return;
  registered = true;
  registerErrorCode({
    code: 'HOST_KEY_UNKNOWN',
    status: 409,
    description: 'The server has no trusted host key yet; the user must verify and trust its fingerprint first.',
  });
  registerErrorCode({
    code: 'HOST_KEY_MISMATCH',
    status: 409,
    description: 'The server presented a different host key than the trusted one; the connection was refused before any credential was sent.',
  });
  registerErrorCode({
    code: 'HOST_KEY_CHANGED_DURING_TRUST',
    status: 409,
    description: 'The key the server presents now is not the fingerprint the user confirmed.',
  });
  registerErrorCode({
    code: 'HOST_KEY_CONFIRMATION_REQUIRED',
    status: 400,
    description: 'Replacing a trusted host key requires the profile hostname typed as confirmation.',
  });
  registerErrorCode({
    code: 'SSH_HOST_UNREACHABLE',
    status: 502,
    description: 'The SSH server could not be reached to read its host key.',
  });
}
