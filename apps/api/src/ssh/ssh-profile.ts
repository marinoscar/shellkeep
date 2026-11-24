// The profile shape the connection factory and its callers share.

/**
 * A server profile with its secrets decrypted, as the SSH layer needs it. The
 * secrets live only for the call; no log, span, error or response carries them.
 */
export interface DecryptedServerProfile {
  id: string;
  userId: string;
  orgId: string;
  hostname: string;
  port: number;
  username: string;
  authMethod: string;
  password?: string | null;
  privateKey?: string | null;
  passphrase?: string | null;
  /** The trusted `SHA256:` host-key fingerprint, or null when none is trusted yet. */
  fingerprint?: string | null;
  hostKeyAlgorithm?: string | null;
}
