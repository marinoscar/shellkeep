// =============================================================================
// Host-key fingerprints for the Doctor probe (issue #46)
// =============================================================================
//
// The OpenSSH fingerprint format: `SHA256:` followed by the base64 of the
// SHA-256 of the key blob, WITHOUT `=` padding (`ssh-keygen -lf`). This is the
// format `server_profiles.fingerprint` holds.
//
// PLATFORM-ADOPTION-SHIM(#60): the host-key trust flow owns the canonical
// `fingerprintOf`; this is the same two lines for the one read-only consumer
// that exists before it, and #60 replaces it (see local-exceptions.md).
// =============================================================================

import { createHash, timingSafeEqual } from 'node:crypto';

/** `SHA256:<base64 without padding>` of an SSH public-key blob, as `ssh-keygen -lf` prints it. */
export function fingerprintOf(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

/** Whether two fingerprints name the same key (padding and surrounding whitespace ignored). */
export function sameFingerprint(a: string, b: string): boolean {
  const left = Buffer.from(a.trim().replace(/=+$/, ''));
  const right = Buffer.from(b.trim().replace(/=+$/, ''));
  return left.length === right.length && timingSafeEqual(left, right);
}
