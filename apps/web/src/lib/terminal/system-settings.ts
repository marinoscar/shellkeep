/**
 * The `terminal` system-settings namespace, web half (issue #46).
 *
 * Mirrors `apps/api/src/terminal/settings/terminal.system-settings.ts`: the
 * session reaper's thresholds and the server profile the Doctor's tmux probe
 * uses. The API validates; these bounds only let the admin page refuse an
 * out-of-range value before it is sent.
 */

import type { SshSystemSettings } from './ssh-system-settings';

/** The namespace's key in the system settings document. */
export const TERMINAL_SYSTEM_SETTINGS_KEY = 'terminal';

export interface TerminalSystemSettings {
  /** A connected session with no client for this long is `detached`. */
  detachAfterMinutes: number;
  /** A `detached` session is terminated after this long. */
  terminateDetachedAfterHours: number;
  /** A `terminated` session row is purged after this long. */
  purgeTerminatedAfterDays: number;
  /** The server profile the Doctor probes, or `null` for none. */
  doctorProbeProfileId: string | null;
}

/** The numeric fields of {@link TerminalSystemSettings}. */
export type TerminalSystemThreshold = Exclude<keyof TerminalSystemSettings, 'doctorProbeProfileId'>;

/** Inclusive bounds; the same as the API's `TERMINAL_SYSTEM_BOUNDS`. */
export const TERMINAL_SYSTEM_BOUNDS: Record<TerminalSystemThreshold, { min: number; max: number }> = {
  detachAfterMinutes: { min: 5, max: 1440 },
  terminateDetachedAfterHours: { min: 1, max: 720 },
  purgeTerminatedAfterDays: { min: 1, max: 365 },
};

/** The API's defaults, used while the namespace is absent from the document. */
export const DEFAULT_TERMINAL_SYSTEM_SETTINGS: TerminalSystemSettings = {
  detachAfterMinutes: 60,
  terminateDetachedAfterHours: 12,
  purgeTerminatedAfterDays: 3,
  doctorProbeProfileId: null,
};

/** The system settings document, as far as this page reads it. */
export interface TerminalSystemSettingsDocument {
  version: number;
  terminal?: Partial<TerminalSystemSettings> | null;
  /** The `ssh` namespace (#60), shown in the same admin page. */
  ssh?: Partial<SshSystemSettings> | null;
}

/** The namespace from a document, with the defaults filled in. */
export function readTerminalSystemSettings(
  document: TerminalSystemSettingsDocument | null,
): TerminalSystemSettings {
  return { ...DEFAULT_TERMINAL_SYSTEM_SETTINGS, ...(document?.terminal ?? {}) };
}

/**
 * The error for one threshold's raw input, or `null` when it is a whole number
 * within its bounds.
 */
export function thresholdError(field: TerminalSystemThreshold, raw: string): string | null {
  const { min, max } = TERMINAL_SYSTEM_BOUNDS[field];
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(value) || value < min || value > max) {
    return `Enter a whole number from ${min} to ${max}.`;
  }
  return null;
}
