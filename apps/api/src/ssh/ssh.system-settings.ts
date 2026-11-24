// =============================================================================
// The `ssh` system-settings namespace (issue #60)
// =============================================================================
//
// The `ssh` key of the `global` row of `system_settings`.
//
//   hostKeyPolicy  what to do with a server whose host key nobody trusted yet
//     tofu_prompt  refuse with HOST_KEY_UNKNOWN; the user verifies and trusts it (default)
//     tofu_auto    trust the presented key on first contact and audit it
//     strict       refuse; an administrator must set the key
//
// A CHANGED key is refused under every policy. No secret lives here.
// =============================================================================

import { z } from 'zod';
import type { SystemSettingsNamespace } from '@marinoscar/platform-api/settings';

import { DEFAULT_HOST_KEY_POLICY, HOST_KEY_POLICIES, type HostKeyPolicy } from './host-key-policy';

export const SSH_SYSTEM_SETTINGS_KEY = 'ssh';

export interface SshSystemSettings {
  hostKeyPolicy: HostKeyPolicy;
}

export type SshSystemSettingsPatch = Partial<SshSystemSettings>;

export const sshSystemSettingsSchema = z.object({
  hostKeyPolicy: z.enum(HOST_KEY_POLICIES),
});

export const sshSystemSettingsPatchSchema = sshSystemSettingsSchema.partial();

export const DEFAULT_SSH_SYSTEM_SETTINGS: SshSystemSettings = {
  hostKeyPolicy: DEFAULT_HOST_KEY_POLICY,
};

export const SSH_SYSTEM_SETTINGS: SystemSettingsNamespace<
  typeof SSH_SYSTEM_SETTINGS_KEY,
  SshSystemSettings,
  SshSystemSettingsPatch
> = {
  key: SSH_SYSTEM_SETTINGS_KEY,
  description: 'SSH host-key trust policy: prompt (default), trust on first use automatically, or strict.',
  storedSchema: sshSystemSettingsSchema,
  patchSchema: sshSystemSettingsPatchSchema,
  putSchema: sshSystemSettingsSchema,
  wirePatchSchema: sshSystemSettingsPatchSchema,
  responseSchema: sshSystemSettingsSchema,
  defaults: DEFAULT_SSH_SYSTEM_SETTINGS,
  // A PUT that omits the namespace keeps the stored value, as every optional namespace does.
  requiredOnPut: false,
  read: (stored, helpers) =>
    helpers.readNamespace(
      stored,
      sshSystemSettingsSchema,
      DEFAULT_SSH_SYSTEM_SETTINGS as unknown as Record<string, unknown>,
    ) as unknown as SshSystemSettings,
  merge: (current, patch) => ({
    hostKeyPolicy: patch?.hostKeyPolicy ?? current.hostKeyPolicy,
  }),
};

declare module '@marinoscar/platform-api/settings' {
  interface SystemSettingsNamespaces {
    ssh: SshSystemSettings;
  }

  interface SystemSettingsNamespaceDeclarations {
    ssh: typeof SSH_SYSTEM_SETTINGS;
  }
}
