// =============================================================================
// SSH credential addresses (issue #48)
// =============================================================================
//
// A server profile's secrets live in the platform's per-user credential store
// (`UserCredentialsService`), purpose `ssh`, one credential per secret field:
//
//   profile.<profileId>.password
//   profile.<profileId>.private_key
//   profile.<profileId>.passphrase
//
// The purpose is permanent (it is also the cipher sub-key domain,
// `user:<userId>:ssh`); a name is valid under the registry's
// `^[A-Za-z0-9][A-Za-z0-9._@-]*$` pattern (a profile id is a UUID).
// No organization or deployment fallback is ever registered for `ssh`
// (`app-registrations/credentials.ts`): a server's secret is its owner's.
// =============================================================================

export const SSH_CREDENTIAL_PURPOSE = 'ssh';

export const SSH_SECRET_FIELDS = ['password', 'private_key', 'passphrase'] as const;

export type SshSecretField = (typeof SSH_SECRET_FIELDS)[number];

/** The credential name of one secret field of a profile. */
export function sshCredentialName(profileId: string, field: SshSecretField): string {
  return `profile.${profileId}.${field}`;
}

/** The profile id and field a credential name addresses, or null when it is not an SSH profile name. */
export function parseSshCredentialName(
  name: string,
): { profileId: string; field: SshSecretField } | null {
  const match = /^profile\.([0-9a-fA-F-]{36})\.(password|private_key|passphrase)$/.exec(name);
  return match ? { profileId: match[1], field: match[2] as SshSecretField } : null;
}
