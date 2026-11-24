// =============================================================================
// Terminal AI settings (issue #56)
// =============================================================================
//
// Two namespaces, both named `terminalAi`:
//
//   system (with a tighten-only org layer)
//     redactionMode   'standard' | 'strict'. `strict` also drops every line that had a finding.
//     requireConsent  whether a user must accept the consent text before terminal output reaches AI.
//     An organization can only TIGHTEN: `strict` wins, and consent required wins.
//
//   user
//     consentAcceptedAt   ISO timestamp of the user's acceptance, or null.
//
// No secret lives in either. Pure data: no Nest, no Prisma (read by the settings-catalog script).
// =============================================================================

import { z } from 'zod';
import type { SystemSettingsNamespace, UserSettingsNamespace } from '@marinoscar/platform-api/settings';

export const TERMINAL_AI_SETTINGS_KEY = 'terminalAi';

export const REDACTION_MODES = ['standard', 'strict'] as const;

export interface TerminalAiSystemSettings {
  redactionMode: (typeof REDACTION_MODES)[number];
  requireConsent: boolean;
}

export type TerminalAiSystemSettingsPatch = Partial<TerminalAiSystemSettings>;

export const DEFAULT_TERMINAL_AI_SYSTEM_SETTINGS: TerminalAiSystemSettings = {
  redactionMode: 'standard',
  requireConsent: true,
};

export const terminalAiSystemSettingsSchema = z.object({
  redactionMode: z.enum(REDACTION_MODES),
  requireConsent: z.boolean(),
});

export const terminalAiSystemSettingsPatchSchema = terminalAiSystemSettingsSchema.partial();

/** The org layer: tighten only. `strict` and "consent required" win over the deployment's value. */
export function tightenTerminalAiSettings(
  system: TerminalAiSystemSettings,
  org: TerminalAiSystemSettingsPatch,
): TerminalAiSystemSettings {
  return {
    redactionMode: system.redactionMode === 'strict' || org.redactionMode === 'strict' ? 'strict' : 'standard',
    requireConsent: system.requireConsent || org.requireConsent === true,
  };
}

export const TERMINAL_AI_SYSTEM_SETTINGS: SystemSettingsNamespace<
  typeof TERMINAL_AI_SETTINGS_KEY,
  TerminalAiSystemSettings,
  TerminalAiSystemSettingsPatch
> = {
  key: TERMINAL_AI_SETTINGS_KEY,
  description:
    'Terminal AI safety: the redaction mode applied to terminal output before any model sees it, and whether users must consent first. Organizations may only tighten these.',
  storedSchema: terminalAiSystemSettingsSchema,
  patchSchema: terminalAiSystemSettingsPatchSchema,
  putSchema: terminalAiSystemSettingsSchema,
  wirePatchSchema: terminalAiSystemSettingsPatchSchema,
  responseSchema: terminalAiSystemSettingsSchema,
  defaults: DEFAULT_TERMINAL_AI_SYSTEM_SETTINGS,
  // A PUT that omits the namespace keeps the stored value, as every optional namespace does.
  requiredOnPut: false,
  read: (stored, helpers) =>
    helpers.readNamespace(
      stored,
      terminalAiSystemSettingsSchema,
      DEFAULT_TERMINAL_AI_SYSTEM_SETTINGS as unknown as Record<string, unknown>,
    ) as unknown as TerminalAiSystemSettings,
  merge: (current, patch) => ({
    redactionMode: patch?.redactionMode ?? current.redactionMode,
    requireConsent: patch?.requireConsent ?? current.requireConsent,
  }),
  org: {
    schema: terminalAiSystemSettingsPatchSchema,
    merge: (system, org) => tightenTerminalAiSettings(system, org as TerminalAiSystemSettingsPatch),
    mode: 'tighten',
    readPermission: 'org_settings:read',
    writePermission: 'org_settings:write',
  },
};

// -----------------------------------------------------------------------------
// User namespace
// -----------------------------------------------------------------------------

export interface TerminalAiUserSettings {
  consentAcceptedAt: string | null;
}

export type TerminalAiUserSettingsPatch = Partial<TerminalAiUserSettings>;

export const terminalAiUserSettingsSchema = z.object({
  consentAcceptedAt: z.string().datetime({ offset: true }).nullable(),
});

export const terminalAiUserSettingsPatchSchema = terminalAiUserSettingsSchema.partial();

export const TERMINAL_AI_USER_SETTINGS: UserSettingsNamespace<
  typeof TERMINAL_AI_SETTINGS_KEY,
  TerminalAiUserSettings,
  TerminalAiUserSettingsPatch
> = {
  key: TERMINAL_AI_SETTINGS_KEY,
  description: 'Terminal AI consent: when the user accepted that redacted terminal output may be sent to AI.',
  schema: terminalAiUserSettingsSchema,
  patchSchema: terminalAiUserSettingsPatchSchema,
  merge(current, patch) {
    if (patch === undefined) return current;
    // JSON Merge Patch: `null` removes the namespace, which withdraws the consent.
    if (patch === null) return undefined;
    return {
      consentAcceptedAt:
        patch.consentAcceptedAt !== undefined
          ? patch.consentAcceptedAt
          : (current?.consentAcceptedAt ?? null),
    };
  },
};

declare module '@marinoscar/platform-api/settings' {
  interface SystemSettingsNamespaces {
    terminalAi: TerminalAiSystemSettings;
  }

  interface SystemSettingsNamespaceDeclarations {
    terminalAi: typeof TERMINAL_AI_SYSTEM_SETTINGS;
  }

  interface UserSettingsNamespaces {
    terminalAi: TerminalAiUserSettings;
  }
}
