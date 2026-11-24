/**
 * The signed-in user's terminal preferences and key layout (issues #48, #80,
 * #165, #169), on the settings slice's packaged `useUserSettings`
 * (`@marinoscar/platform-web/settings/headless`).
 *
 * The API returns the `terminal` and `shortcuts` namespaces only when they are
 * stored; this hook always hands out the resolved values
 * (`resolveTerminalSettings`, `resolveKeyLayout`, `resolveKeyOptions`: the
 * defaults for an absent namespace or field, and a v1 shortcut list, also the
 * legacy `terminal.keyShortcuts`, converted to a layout). Since #169 nothing
 * writes the v1 `shortcuts.keyShortcuts` list: a key save carries only
 * `layout` and `options`, and the API keeps the stored list (the rollback
 * source of the v2 migration). So the terminal, the key row and the scroll
 * buttons never depend on whether a row was written. A save sends the whole
 * `terminal` namespace, or the changed `shortcuts` fields, with the loaded
 * version as `If-Match`; a 409 refetches and rejects.
 *
 * Every instance shares what it loads or saves (`lib/terminal/settingsSync.ts`),
 * so a change made on the Terminal settings page or by a toolbar toggle reaches
 * every open terminal, in this tab and in others, without reconnecting.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  useUserSettings,
  type UserSettingsUpdateBase,
} from '@marinoscar/platform-web/settings/headless';
import { platformApi } from '../services/api';
import {
  DEFAULT_TERMINAL_SETTINGS,
  resolveKeyLayout,
  resolveKeyOptions,
  resolveTerminalSettings,
  terminalPatch,
  type ResolvedTerminalSettings,
} from '../lib/terminal/settings';
import type { KeyLayout, KeyOptions } from '../lib/terminal/keys/keyModel';
import { publishTerminalSettings, subscribeTerminalSettings } from '../lib/terminal/settingsSync';
import type {
  ActionShortcuts,
  TerminalUserSettingsDocument,
  TerminalUserSettingsUpdate,
} from '../types/terminal';

/** The loaded document with both namespaces resolved. */
export type ResolvedTerminalUserSettingsDocument = Omit<
  TerminalUserSettingsDocument,
  'terminal' | 'shortcuts'
> & {
  terminal: ResolvedTerminalSettings;
  shortcuts: {
    actions?: ActionShortcuts;
    /** The v2 layout and options, resolved (#165). */
    layout: KeyLayout;
    options: KeyOptions;
  };
};

/** A change to the key layout and/or its options (#169). */
export interface KeyLayoutChange {
  layout?: KeyLayout;
  options?: KeyOptions;
}

/** A change to the terminal preferences and/or the keys. */
export interface TerminalSettingsChange {
  terminal?: Partial<ResolvedTerminalSettings>;
  shortcuts?: KeyLayoutChange;
}

export interface UseTerminalSettingsResult {
  /** The document with both namespaces resolved, or `null` until loaded. */
  settings: ResolvedTerminalUserSettingsDocument | null;
  /** The resolved terminal preferences, or `null` until loaded. */
  terminal: ResolvedTerminalSettings | null;
  /** The v2 key layout (#165), resolved: stored, else the v1 list converted, else the defaults. */
  keyLayout: KeyLayout | null;
  /** The key bar options (#165), resolved. */
  keyOptions: KeyOptions | null;
  /** Rebound app-action shortcuts (#57); `{}` when none. */
  actionShortcuts: ActionShortcuts;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  /** Saves `changes` over the current terminal preferences. */
  updateTerminal: (changes: Partial<ResolvedTerminalSettings>) => Promise<void>;
  /**
   * Saves the key layout and/or options (#169): the PATCH carries only `layout`
   * and `options` under `shortcuts`, never `keyShortcuts` (the API keeps the
   * stored v1 list and the rebound actions).
   */
  updateKeys: (change: KeyLayoutChange) => Promise<void>;
  /** Saves both namespaces of `change` in one write. */
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
    replaceSettings,
  } = useUserSettings<
    TerminalUserSettingsDocument,
    UserSettingsUpdateBase & TerminalUserSettingsUpdate
  >({
    // Passed explicitly (a module constant), so the terminal pages need no host.
    api: platformApi,
    // Not the Appearance page: never stamp the stored theme over the AppBar toggle.
    syncTheme: false,
  });

  // Take a newer document another instance (or tab) loaded or saved.
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const listenerRef = useRef<(document: TerminalUserSettingsDocument) => void>(() => {});
  useEffect(() => {
    const listener = (document: TerminalUserSettingsDocument) => {
      const current = storedRef.current;
      if (current && document.version > current.version) replaceSettings(document);
    };
    listenerRef.current = listener;
    return subscribeTerminalSettings(listener);
  }, [replaceSettings]);

  // Share what this instance holds.
  useEffect(() => {
    if (stored) publishTerminalSettings(stored, listenerRef.current);
  }, [stored]);

  const terminal = useMemo(
    () => (stored ? resolveTerminalSettings(stored.terminal) : null),
    [stored],
  );
  const keyLayout = useMemo(() => (stored ? resolveKeyLayout(stored) : null), [stored]);
  const keyOptions = useMemo(() => (stored ? resolveKeyOptions(stored) : null), [stored]);

  const settings = useMemo<ResolvedTerminalUserSettingsDocument | null>(
    () =>
      stored && terminal && keyLayout && keyOptions
        ? {
            ...stored,
            terminal,
            shortcuts: {
              layout: keyLayout,
              options: keyOptions,
              ...(stored.shortcuts?.actions ? { actions: stored.shortcuts.actions } : {}),
            },
          }
        : null,
    [stored, terminal, keyLayout, keyOptions],
  );

  const updateSettings = useCallback(
    async (change: TerminalSettingsChange) => {
      const body: TerminalUserSettingsUpdate = {};
      if (change.terminal) {
        body.terminal = terminalPatch(terminal ?? DEFAULT_TERMINAL_SETTINGS, change.terminal);
      }
      if (change.shortcuts) {
        // Only what changed: the namespace merge keeps `keyShortcuts` and the rebound actions.
        const shortcuts: KeyLayoutChange = {};
        if (change.shortcuts.layout) shortcuts.layout = change.shortcuts.layout;
        if (change.shortcuts.options) shortcuts.options = change.shortcuts.options;
        body.shortcuts = shortcuts;
      }
      await patch(body);
    },
    [patch, terminal],
  );

  const updateTerminal = useCallback(
    (changes: Partial<ResolvedTerminalSettings>) => updateSettings({ terminal: changes }),
    [updateSettings],
  );

  const updateKeys = useCallback(
    (change: KeyLayoutChange) => updateSettings({ shortcuts: change }),
    [updateSettings],
  );

  return {
    settings,
    terminal,
    keyLayout,
    keyOptions,
    actionShortcuts: stored?.shortcuts?.actions ?? {},
    isLoading,
    isSaving,
    error,
    updateTerminal,
    updateKeys,
    updateSettings,
    refresh,
  };
}
