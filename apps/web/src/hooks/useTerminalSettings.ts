/**
 * The signed-in user's terminal preferences and key shortcuts (issues #48,
 * #80), on the settings slice's packaged `useUserSettings`
 * (`@marinoscar/platform-web/settings/headless`).
 *
 * The API returns the `terminal` and `shortcuts` namespaces only when they are
 * stored; this hook always hands out the resolved values
 * (`resolveTerminalSettings`, `resolveKeyShortcuts`: the defaults for an absent
 * namespace or field, and the legacy `terminal.keyShortcuts` through the shim),
 * so the terminal, the key bar and the scroll buttons never depend on whether a
 * row was written. A save sends the whole namespace with the loaded version as
 * `If-Match`; a 409 refetches and rejects.
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
  normalizeKeyShortcuts,
  resolveKeyLayout,
  resolveKeyOptions,
  resolveKeyShortcuts,
  resolveTerminalSettings,
  terminalPatch,
  type ResolvedTerminalSettings,
} from '../lib/terminal/settings';
import { layoutFromLegacyShortcuts } from '../lib/terminal/keys/legacyAdapter';
import type { KeyLayout, KeyOptions } from '../lib/terminal/keys/keyModel';
import { publishTerminalSettings, subscribeTerminalSettings } from '../lib/terminal/settingsSync';
import type {
  ActionShortcuts,
  KeyShortcut,
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
    keyShortcuts: KeyShortcut[];
    actions?: ActionShortcuts;
    /** The v2 layout and options, resolved (#165). */
    layout: KeyLayout;
    options: KeyOptions;
  };
};

/** A change to the terminal preferences and/or the shortcut list. */
export interface TerminalSettingsChange {
  terminal?: Partial<ResolvedTerminalSettings>;
  shortcuts?: { keyShortcuts: KeyShortcut[]; layout?: KeyLayout; options?: KeyOptions };
}

export interface UseTerminalSettingsResult {
  /** The document with both namespaces resolved, or `null` until loaded. */
  settings: ResolvedTerminalUserSettingsDocument | null;
  /** The resolved terminal preferences, or `null` until loaded. */
  terminal: ResolvedTerminalSettings | null;
  /** The resolved key shortcuts, or `null` until loaded. */
  keyShortcuts: KeyShortcut[] | null;
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
  /** Replaces the key shortcut list (stored in the `shortcuts` namespace). */
  updateShortcuts: (keyShortcuts: readonly KeyShortcut[]) => Promise<void>;
  /**
   * Saves the key layout and/or options (#169): the PATCH carries only `layout`
   * and `options` under `shortcuts`, never `keyShortcuts` (the API keeps the
   * stored v1 list and the rebound actions).
   */
  updateKeys: (change: { layout?: KeyLayout; options?: KeyOptions }) => Promise<void>;
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
  const keyShortcuts = useMemo(() => (stored ? resolveKeyShortcuts(stored) : null), [stored]);

  const keyLayout = useMemo(() => (stored ? resolveKeyLayout(stored) : null), [stored]);
  const keyOptions = useMemo(() => (stored ? resolveKeyOptions(stored) : null), [stored]);

  const settings = useMemo<ResolvedTerminalUserSettingsDocument | null>(
    () =>
      stored && terminal && keyShortcuts && keyLayout && keyOptions
        ? {
            ...stored,
            terminal,
            shortcuts: {
              keyShortcuts,
              layout: keyLayout,
              options: keyOptions,
              ...(stored.shortcuts?.actions ? { actions: stored.shortcuts.actions } : {}),
            },
          }
        : null,
    [stored, terminal, keyShortcuts, keyLayout, keyOptions],
  );

  const updateSettings = useCallback(
    async (change: TerminalSettingsChange) => {
      const body: TerminalUserSettingsUpdate = {};
      if (change.terminal) {
        body.terminal = terminalPatch(terminal ?? DEFAULT_TERMINAL_SETTINGS, change.terminal);
      }
      if (change.shortcuts) {
        // Writing the list must not drop the rebound app actions stored beside it.
        const keyShortcuts = normalizeKeyShortcuts(change.shortcuts.keyShortcuts);
        // A stored v2 layout would otherwise outlive the list the bar is fed from:
        // the legacy editor's list becomes the layout too (#165), until #169.
        const layout =
          change.shortcuts.layout ?? (stored?.shortcuts?.layout ? layoutFromLegacyShortcuts(keyShortcuts) : undefined);
        const options = change.shortcuts.options ?? stored?.shortcuts?.options;
        body.shortcuts = {
          keyShortcuts,
          ...(stored?.shortcuts?.actions ? { actions: stored.shortcuts.actions } : {}),
          ...(layout ? { layout } : {}),
          ...(options ? { options } : {}),
        };
      }
      await patch(body);
    },
    [patch, terminal, stored],
  );

  const updateTerminal = useCallback(
    (changes: Partial<ResolvedTerminalSettings>) => updateSettings({ terminal: changes }),
    [updateSettings],
  );

  const updateShortcuts = useCallback(
    (list: readonly KeyShortcut[]) => updateSettings({ shortcuts: { keyShortcuts: [...list] } }),
    [updateSettings],
  );

  const updateKeys = useCallback(
    async (change: { layout?: KeyLayout; options?: KeyOptions }) => {
      const shortcuts: { layout?: KeyLayout; options?: KeyOptions } = {};
      if (change.layout) shortcuts.layout = change.layout;
      if (change.options) shortcuts.options = change.options;
      // The namespace's merge keeps every field the patch leaves out.
      await patch({ shortcuts });
    },
    [patch],
  );

  return {
    settings,
    terminal,
    keyShortcuts,
    keyLayout,
    keyOptions,
    actionShortcuts: stored?.shortcuts?.actions ?? {},
    isLoading,
    isSaving,
    error,
    updateTerminal,
    updateShortcuts,
    updateKeys,
    updateSettings,
    refresh,
  };
}
