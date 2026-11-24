// =============================================================================
// The host-key refusal (issue #60)
// =============================================================================
//
// Raised by the connection factory BEFORE user authentication, so no credential
// has been sent when a caller sees it. `presented` is the key the server showed;
// `expected` is the fingerprint the profile trusts (absent when it trusts none).
// =============================================================================

export type HostKeyErrorCode = 'HOST_KEY_UNKNOWN' | 'HOST_KEY_MISMATCH';

export interface PresentedHostKey {
  fingerprint: string;
  algorithm: string;
}

export class HostKeyError extends Error {
  constructor(
    readonly code: HostKeyErrorCode,
    readonly presented: PresentedHostKey,
    readonly expected?: string,
    readonly serverProfileId?: string,
  ) {
    super(
      code === 'HOST_KEY_MISMATCH'
        ? 'The server presented a different host key than the one trusted for this profile'
        : 'The host key of this server is not trusted yet',
    );
    this.name = 'HostKeyError';
  }
}
