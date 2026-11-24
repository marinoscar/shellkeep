/**
 * The `ssh` system-settings namespace, web half (issue #60).
 *
 * Mirrors `apps/api/src/ssh/ssh.system-settings.ts`: what the SSH layer does
 * with a server whose host key nobody trusted yet. A changed key is refused
 * under every policy.
 */

export const SSH_SYSTEM_SETTINGS_KEY = 'ssh';

export const HOST_KEY_POLICIES = ['tofu_prompt', 'tofu_auto', 'strict'] as const;
export type HostKeyPolicy = (typeof HOST_KEY_POLICIES)[number];

export interface SshSystemSettings {
  hostKeyPolicy: HostKeyPolicy;
}

/** The API's default, used while the namespace is absent from the document. */
export const DEFAULT_SSH_SYSTEM_SETTINGS: SshSystemSettings = { hostKeyPolicy: 'tofu_prompt' };

/** The label and explanation of each policy, in the order the select lists them. */
export const HOST_KEY_POLICY_OPTIONS: { value: HostKeyPolicy; label: string; help: string }[] = [
  {
    value: 'tofu_prompt',
    label: 'Ask the user to verify (recommended)',
    help: 'A new server is refused until the user compares and trusts its fingerprint.',
  },
  {
    value: 'tofu_auto',
    label: 'Trust on first use automatically',
    help: 'The first key a server presents is trusted without asking (audited). Weaker: an interception on first contact goes unnoticed.',
  },
  {
    value: 'strict',
    label: 'Strict',
    help: 'A server with no trusted key is always refused; its key must be set before anyone connects.',
  },
];

/** The namespace from a document, with the default filled in and an unknown value ignored. */
export function readSshSystemSettings(
  document: { ssh?: Partial<SshSystemSettings> | null } | null,
): SshSystemSettings {
  const policy = document?.ssh?.hostKeyPolicy;
  return {
    hostKeyPolicy: (HOST_KEY_POLICIES as readonly string[]).includes(policy ?? '')
      ? (policy as HostKeyPolicy)
      : DEFAULT_SSH_SYSTEM_SETTINGS.hostKeyPolicy,
  };
}
