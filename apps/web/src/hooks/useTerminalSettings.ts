/**
 * The signed-in user's terminal preferences (issue #48), on the settings
 * slice's packaged `useUserSettings` (`@marinoscar/platform-web/settings/headless`).
 *
 * The API returns the `terminal` namespace only when it is stored; this hook
 * always hands out the resolved preferences (`resolveTerminalSettings`: the
 * defaults for an absent namespace or field), so the key bar and the scroll
 * buttons never depend on whether a row was written. A save sends the whole
 * namespace (`terminalPatch`: every keystroke carries `modifiers`) with the
 * loaded version as `If-Match`; a 409 refetches and rejects.
 *
 * `settings.terminal` is the RESOLVED namespace too, so a page that reads
 * `settings?.terminal?.keyShortcuts` gets the defaults once the document loads.
 */

import { useCallback, useMemo } from 'react';
import {
  useUserSettings,
  type UserSettingsUpdateBase,
} from '@marinoscar/platform-web/settings/headless';
import { platformApi } from '../services/api';
import {
  DEFAULT_TERMINAL_SETTINGS,
  resolveTerminalSettings,
  terminalPatch,
  type ResolvedTerminalSettings,
} from '../lib/terminal/settings';
import type {
  TerminalUserSettings,
  TerminalUserSettingsDocument,
  TerminalUserSettingsUpdate,
} from '../types/terminal';

/** The loaded document with the terminal namespace resolved. */
export type ResolvedTerminalUserSettingsDocument = Omit<TerminalUserSettingsDocument, 'terminal'> & {
  terminal: ResolvedTerminalSettings;
};

/** A change to the terminal preferences: the fields to replace. */
export interface TerminalSettingsChange {
  terminal?: Partial<TerminalUserSettings>;
}

export interface UseTerminalSettingsResult {
  /** The document with `terminal` resolved, or `null` until loaded. */
  settings: ResolvedTerminalUserSettingsDocument | null;
  /** The resolved terminal preferences, or `null` until loaded. */
  terminal: ResolvedTerminalSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  /** Saves `changes` over the current preferences. */
  updateTerminal: (changes: Partial<TerminalUserSettings>) => Promise<void>;
  /** `updateTerminal(change.terminal)`, for callers written against the settings document. */
  updateSettings: (change: TerminalSettingsChange) => Promise<void>;
  /** Reloads the document. */
  refresh: () => Promise<void>;
}

export function useTerminalSettings(): UseTerminalSettingsResult {
  const {
    settings: stored,
    isLoading,
    isSaving,
    error,
    updateSettings: patch,
    refresh,
  } = useUserSettings<
    TerminalUserSettingsDocument,
    UserSettingsUpdateBase & TerminalUserSettingsUpdate
  >({
    // Passed explicitly (a module constant), so the terminal pages need no host.
    api: platformApi,
    // Not the Appearance page: never stamp the stored theme over the AppBar toggle.
    syncTheme: false,
  });

  const terminal = useMemo(
    () => (stored ? resolveTerminalSettings(stored.terminal) : null),
    [stored],
  );

  const settings = useMemo<ResolvedTerminalUserSettingsDocument | null>(
    () => (stored && terminal ? { ...stored, terminal } : null),
    [stored, terminal],
  );

  const updateTerminal = useCallback(
    async (changes: Partial<TerminalUserSettings>) => {
      await patch({ terminal: terminalPatch(terminal ?? DEFAULT_TERMINAL_SETTINGS, changes) });
    },
    [patch, terminal],
  );

  const updateSettings = useCallback(
    (change: TerminalSettingsChange) => updateTerminal(change.terminal ?? {}),
    [updateTerminal],
  );

  return { settings, terminal, isLoading, isSaving, error, updateTerminal, updateSettings, refresh };
}
