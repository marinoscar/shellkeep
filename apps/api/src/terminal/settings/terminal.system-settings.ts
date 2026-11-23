// =============================================================================
// Terminal system-settings namespace
// =============================================================================
//
// The `terminal` key of the `global` row of `system_settings`: the session
// reaper's thresholds and the profile the Doctor probes. Declared here, in the
// terminal domain, and registered with the platform settings slice's system
// namespace registry by `platform/settings/registry.ts` (#48).
//
//   detachAfterMinutes           a connected session with no client for this long is `detached`
//   terminateDetachedAfterHours  a `detached` session is terminated after this long
//   purgeTerminatedAfterDays     a `terminated` session row is purged after this long
//   doctorProbeProfileId         the server profile the Doctor probes (#46), or null
//
// `terminal/jobs/session-reap.handler.ts` (#49) reads the three thresholds on every run, so
// a change applies without a deploy.
//
// No secret lives in this namespace.
// =============================================================================

import { z } from 'zod';
import type { SystemSettingsNamespace } from '@marinoscar/platform-api/settings';

export const TERMINAL_SYSTEM_SETTINGS_KEY = 'terminal';

export interface TerminalSystemSettings {
  detachAfterMinutes: number;
  terminateDetachedAfterHours: number;
  purgeTerminatedAfterDays: number;
  doctorProbeProfileId: string | null;
}

export type TerminalSystemSettingsPatch = Partial<TerminalSystemSettings>;

export const TERMINAL_SYSTEM_BOUNDS = {
  detachAfterMinutes: { min: 5, max: 1440 },
  terminateDetachedAfterHours: { min: 1, max: 720 },
  purgeTerminatedAfterDays: { min: 1, max: 365 },
} as const;

export const terminalSystemSettingsSchema = z.object({
  detachAfterMinutes: z
    .number()
    .int()
    .min(TERMINAL_SYSTEM_BOUNDS.detachAfterMinutes.min)
    .max(TERMINAL_SYSTEM_BOUNDS.detachAfterMinutes.max),
  terminateDetachedAfterHours: z
    .number()
    .int()
    .min(TERMINAL_SYSTEM_BOUNDS.terminateDetachedAfterHours.min)
    .max(TERMINAL_SYSTEM_BOUNDS.terminateDetachedAfterHours.max),
  purgeTerminatedAfterDays: z
    .number()
    .int()
    .min(TERMINAL_SYSTEM_BOUNDS.purgeTerminatedAfterDays.min)
    .max(TERMINAL_SYSTEM_BOUNDS.purgeTerminatedAfterDays.max),
  doctorProbeProfileId: z.string().uuid().nullable(),
});

export const terminalSystemSettingsPatchSchema = terminalSystemSettingsSchema.partial();

export const DEFAULT_TERMINAL_SYSTEM_SETTINGS: TerminalSystemSettings = {
  detachAfterMinutes: 60,
  terminateDetachedAfterHours: 12,
  purgeTerminatedAfterDays: 3,
  doctorProbeProfileId: null,
};

export const TERMINAL_SYSTEM_SETTINGS: SystemSettingsNamespace<
  typeof TERMINAL_SYSTEM_SETTINGS_KEY,
  TerminalSystemSettings,
  TerminalSystemSettingsPatch
> = {
  key: TERMINAL_SYSTEM_SETTINGS_KEY,
  description:
    'Terminal session lifecycle thresholds (detach, terminate, purge) and the profile the Doctor probes.',
  storedSchema: terminalSystemSettingsSchema,
  patchSchema: terminalSystemSettingsPatchSchema,
  putSchema: terminalSystemSettingsSchema,
  wirePatchSchema: terminalSystemSettingsPatchSchema,
  responseSchema: terminalSystemSettingsSchema,
  defaults: DEFAULT_TERMINAL_SYSTEM_SETTINGS,
  // A PUT that omits the namespace keeps the stored value, as every optional namespace does.
  requiredOnPut: false,
  // A stored field that no longer validates (a bound tightened later) reads as its default.
  read: (stored, helpers) =>
    helpers.readNamespace(
      stored,
      terminalSystemSettingsSchema,
      DEFAULT_TERMINAL_SYSTEM_SETTINGS as unknown as Record<string, unknown>,
    ) as unknown as TerminalSystemSettings,
  merge: (current, patch) => ({
    detachAfterMinutes: patch?.detachAfterMinutes ?? current.detachAfterMinutes,
    terminateDetachedAfterHours:
      patch?.terminateDetachedAfterHours ?? current.terminateDetachedAfterHours,
    purgeTerminatedAfterDays: patch?.purgeTerminatedAfterDays ?? current.purgeTerminatedAfterDays,
    // `null` clears the probe profile; `undefined` keeps it.
    doctorProbeProfileId:
      patch?.doctorProbeProfileId !== undefined
        ? patch.doctorProbeProfileId
        : current.doctorProbeProfileId,
  }),
};

declare module '@marinoscar/platform-api/settings' {
  interface SystemSettingsNamespaces {
    terminal: TerminalSystemSettings;
  }

  interface SystemSettingsNamespaceDeclarations {
    terminal: typeof TERMINAL_SYSTEM_SETTINGS;
  }
}
