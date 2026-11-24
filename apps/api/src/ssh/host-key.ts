// =============================================================================
// Host-key fingerprints (issue #60)
// =============================================================================
//
// The OpenSSH fingerprint format: `SHA256:` followed by the base64 of the
// SHA-256 of the key blob, WITHOUT `=` padding (`ssh-keygen -lf`). This is the
// format `server_profiles.fingerprint` holds and every client sees.
//
// A key blob is the wire form of a public key: an SSH string naming the
// algorithm (`ssh-ed25519`, `ssh-rsa`, ...) followed by the algorithm's fields.
// =============================================================================

import { createHash, timingSafeEqual } from 'node:crypto';

/** `SHA256:<base64 without padding>` of an SSH public-key blob, as `ssh-keygen -lf` prints it. */
export function fingerprintOf(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

/** What `algorithmOf` answers for a blob that does not start with a well-formed SSH string. */
export const UNKNOWN_HOST_KEY_ALGORITHM = 'unknown';

/**
 * The algorithm name a key blob starts with (`ssh-ed25519`, `ssh-rsa`,
 * `ecdsa-sha2-nistp256`): the blob's leading SSH string (a big-endian uint32
 * length, then that many bytes). `unknown` for a blob that is too short or
 * whose length runs past its end.
 */
export function algorithmOf(key: Buffer): string {
  if (key.length < 4) return UNKNOWN_HOST_KEY_ALGORITHM;
  const length = key.readUInt32BE(0);
  if (length === 0 || length > 64 || 4 + length > key.length) return UNKNOWN_HOST_KEY_ALGORITHM;
  const name = key.subarray(4, 4 + length).toString('latin1');
  return /^[a-z0-9@._-]+$/i.test(name) ? name : UNKNOWN_HOST_KEY_ALGORITHM;
}

/** Whether two fingerprints name the same key (padding and surrounding whitespace ignored). */
export function sameFingerprint(a: string, b: string): boolean {
  const left = Buffer.from(a.trim().replace(/=+$/, ''));
  const right = Buffer.from(b.trim().replace(/=+$/, ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The shape of a fingerprint a client may send (`SHA256:` and 43 base64 characters). */
export const FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/;
