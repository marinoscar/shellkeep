// =============================================================================
// Compatibility adapter between the v1 shortcut list and the v2 key layout
// (issue #165)
// =============================================================================
//
// A v1 `keyShortcuts` list (label plus keystrokes) becomes a v2 layout for a
// row the settings migration has not reached yet (`layoutFromLegacyShortcuts`).
// The reverse direction (`toLegacyBarKeys`) fed the legacy shortcuts editor
// and is gone since #169: nothing writes the v1 list any more.
// =============================================================================

import type { KeyShortcut } from '../../../types/terminal';
import {
  getCatalogKey,
  isInlineEntry,
  legacyShortcutsToDefaultLayout,
  legacyShortcutsToLayout,
  type KeyLayout,
} from './keyModel';

/** The modifier keys a bar can toggle (#166). */
export type BarModifierId = 'ctrl' | 'alt' | 'shift';

/**
 * The modifier keys (`ctrl`, `alt`, `shift`) of a layout, in layout order and
 * once each: the bar draws them as toggles until #167 draws the whole layout.
 */
export function toBarModifierKeys(layout: KeyLayout): BarModifierId[] {
  const out: BarModifierId[] = [];
  for (const group of layout.groups) {
    for (const entry of group.keys) {
      if (isInlineEntry(entry)) continue;
      if (getCatalogKey(entry.id)?.kind !== 'modifier') continue;
      const id = entry.id as BarModifierId;
      if (!out.includes(id)) out.push(id);
    }
  }
  return out;
}

/** The v2 layout holding exactly a v1 shortcut list (the v1 shortcuts as inline macros, ids and labels kept). */
export function fromLegacyShortcuts(shortcuts: readonly KeyShortcut[]): KeyLayout {
  return legacyShortcutsToLayout(shortcuts);
}

/**
 * The layout a user with a v1 list gets (epic #171): `DEFAULT_KEY_LAYOUT`
 * (Ctrl/Alt toggles included) plus the shortcuts it does not already send. What
 * the settings migration writes; used where the client derives a layout from a list.
 */
export function layoutFromLegacyShortcuts(shortcuts: readonly KeyShortcut[]): KeyLayout {
  return legacyShortcutsToDefaultLayout(shortcuts);
}
