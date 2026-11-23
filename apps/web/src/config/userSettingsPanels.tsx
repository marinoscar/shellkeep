import type { ComponentType } from 'react';
import { KeyShortcutsSettings } from '../components/terminal/settings/KeyShortcutsSettings';

/** What the user settings page passes every panel. */
export interface UserSettingsPanelProps {
  /** True while a save is in flight. */
  disabled?: boolean;
}

/**
 * A domain panel drawn on the user settings page after the base panels
 * (theme, profile). Declared here, in the composition root, so the base
 * settings code never imports a domain component. Transitional: #80 turns
 * each entry into a card of `USER_SETTINGS_SECTIONS` (`userSettingsSections.tsx`).
 */
export interface UserSettingsPanel {
  /** Stable key. */
  id: string;
  /** The panel component (a module-level component, a stable reference). */
  Component: ComponentType<UserSettingsPanelProps>;
}

/** Domain panels on the user settings page, in display order. */
export const USER_SETTINGS_PANELS: readonly UserSettingsPanel[] = [
  { id: 'terminal-key-shortcuts', Component: KeyShortcutsSettings },
];
