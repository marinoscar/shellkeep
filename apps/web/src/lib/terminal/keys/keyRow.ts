// =============================================================================
// The key row and the key panel's view of a layout (issue #167, epic #171)
// =============================================================================
//
// `resolveKeyGroups` turns the user's v2 `KeyLayout` into what the accessory
// row and the full key panel draw: each entry resolved to its kind, label and
// span, action keys the host cannot run left out, and empty groups dropped.
// `encodeResolvedKey` is the one encoder both use. Pure: no React, no DOM.
// =============================================================================

import { encodeKey, type EncodeOptions } from './encodeKey';
import {
  entrySpan,
  getCatalogKey,
  isInlineEntry,
  type InlineKey,
  type KeyKind,
  type KeyLayout,
  type KeySpan,
} from './keyModel';
import { ALT_POPUP, ARROW_POPUP, CTRL_POPUP, type PopupEntry } from './popupKeys';

/** The app actions a key can run (catalog `action` ids). */
export type KeyActionId = 'ai' | 'arrow-drag' | 'attach-file' | 'snippets';

/** The modifiers the row and the panel draw as toggles. */
export type KeyModifierId = 'ctrl' | 'alt' | 'shift';

/** One key as the row and the panel draw it. */
export interface ResolvedKey {
  /** Unique in the layout (a React key): the inline id, or the catalog id with its position. */
  uid: string;
  kind: KeyKind;
  label: string;
  span: KeySpan;
  /** Holding the key repeats it (#168 adds the repeat). */
  repeatable: boolean;
  /** The catalog id (`esc`, `ctrl`, `ai`, ...), absent for an inline key. */
  catalogId?: string;
  /** The macro or custom key, absent for a catalog key. */
  inline?: InlineKey;
}

/** One group of the layout: a row of the panel's grid, a run of the accessory row. */
export interface ResolvedGroup {
  /** The group's index in the stored layout. */
  index: number;
  keys: ResolvedKey[];
}

/**
 * The layout's groups in order, each entry resolved. An action key is kept only
 * when `availableActions` has it (the AI key needs AI, attach needs
 * `sessions:write`, drag and snippets wait for #168 and #172). Unknown catalog
 * ids are skipped; a group left empty is dropped.
 */
export function resolveKeyGroups(
  layout: KeyLayout,
  availableActions: ReadonlySet<KeyActionId>,
): ResolvedGroup[] {
  const groups: ResolvedGroup[] = [];
  layout.groups.forEach((group, index) => {
    const keys: ResolvedKey[] = [];
    group.keys.forEach((entry, position) => {
      const span = entrySpan(entry);
      if (isInlineEntry(entry)) {
        keys.push({ uid: entry.key.id, kind: entry.key.kind, label: entry.key.label, span, repeatable: false, inline: entry.key });
        return;
      }
      const catalog = getCatalogKey(entry.id);
      if (!catalog) return;
      if (catalog.kind === 'action' && !availableActions.has(catalog.id as KeyActionId)) return;
      keys.push({
        uid: `${index}:${position}:${catalog.id}`,
        kind: catalog.kind,
        label: catalog.label,
        span,
        repeatable: catalog.repeatable,
        catalogId: catalog.id,
      });
    });
    if (keys.length > 0) groups.push({ index, keys });
  });
  return groups;
}

/**
 * The bytes a key sends: a catalog key with the armed modifiers and the cursor
 * mode, a macro chord by chord, a custom key verbatim. Modifier and action keys
 * send nothing (`''`), and so does a key the encoder refuses (an invalid custom
 * sequence the API would have refused at save time).
 */
export function encodeResolvedKey(key: ResolvedKey, options: EncodeOptions = {}): string {
  try {
    if (key.inline) return encodeKey(key.inline, options);
    if (key.catalogId) return encodeKey(key.catalogId, options);
  } catch {
    return '';
  }
  return '';
}

const ARROW_IDS = new Set(['left', 'right', 'up', 'down']);

/** The long-press pop-up of a key (#166): Ctrl and Alt combos, the navigation keys on an arrow. */
export function popupOf(key: ResolvedKey): { title: string; entries: readonly PopupEntry[] } | null {
  if (key.catalogId === 'ctrl') return { title: 'Ctrl combinations', entries: CTRL_POPUP };
  if (key.catalogId === 'alt') return { title: 'Alt combinations', entries: ALT_POPUP };
  if (key.catalogId && ARROW_IDS.has(key.catalogId)) return { title: 'Navigation keys', entries: ARROW_POPUP };
  return null;
}
