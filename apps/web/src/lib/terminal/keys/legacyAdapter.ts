// =============================================================================
// Compatibility adapter: the v2 key layout as the v1 key bar's shortcuts
// (issue #165)
// =============================================================================
//
// `TerminalKeyShortcutsBar` renders and sends `KeyShortcut`s (label plus
// keystrokes, `encodeShortcut`). Until #167 replaces it, the bar is fed from the
// v2 layout through `toLegacyBarKeys`, so what it draws and sends does not change.
// =============================================================================

import type { KeyShortcut, Keystroke } from '../../../types/terminal';
import {
  getCatalogKey,
  isInlineEntry,
  legacyShortcutsToLayout,
  type Chord,
  type KeyLayout,
} from './keyModel';

function toKeystroke(chord: Chord): Keystroke {
  // A chord key outside the v1 base keys (`%`, `"`) is still one printable
  // character, which `encodeKeystroke` sends as itself.
  return { modifiers: [...chord.modifiers], key: chord.key as Keystroke['key'] };
}

/**
 * The bar's shortcuts for a layout, in order: a catalog `key` becomes its
 * chord, a macro its chords (the id and label are kept). Modifier, action and
 * custom keys have no v1 form and are left out (the new bar draws them).
 */
export function toLegacyBarKeys(layout: KeyLayout): KeyShortcut[] {
  const out: KeyShortcut[] = [];
  for (const group of layout.groups) {
    for (const entry of group.keys) {
      if (isInlineEntry(entry)) {
        if (entry.key.kind === 'macro') {
          out.push({
            id: entry.key.id,
            label: entry.key.label,
            keystrokes: entry.key.chords.map(toKeystroke),
          });
        }
        continue;
      }
      const catalog = getCatalogKey(entry.id);
      if (catalog?.kind === 'key' && catalog.chord) {
        out.push({ id: `catalog:${catalog.id}`, label: catalog.label, keystrokes: [toKeystroke(catalog.chord)] });
      }
    }
  }
  return out;
}

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

/** The v2 layout holding exactly a v1 shortcut list (the inverse of `toLegacyBarKeys` for it). */
export function fromLegacyShortcuts(shortcuts: readonly KeyShortcut[]): KeyLayout {
  return legacyShortcutsToLayout(shortcuts);
}
