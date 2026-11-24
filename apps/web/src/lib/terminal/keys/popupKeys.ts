// =============================================================================
// Long-press pop-ups of the key bar (issue #166)
// =============================================================================

import type { Chord } from './keyModel';

export interface PopupEntry {
  label: string;
  chord: Chord;
}

const ctrl = (key: string): PopupEntry => ({ label: `Ctrl+${key.toUpperCase()}`, chord: { modifiers: ['ctrl'], key } });
const alt = (key: string, label = key.toUpperCase()): PopupEntry => ({
  label: `Alt+${label}`,
  chord: { modifiers: ['alt'], key },
});
const plain = (key: string, label: string): PopupEntry => ({ label, chord: { modifiers: [], key } });

/** Long-press on Ctrl: the common shell combos. */
export const CTRL_POPUP: readonly PopupEntry[] = ['c', 'd', 'z', 'r', 'l', 'a', 'e', 'w', 'u', 'k'].map(ctrl);

/** Long-press on Alt: word back, word forward, last argument. */
export const ALT_POPUP: readonly PopupEntry[] = [alt('b'), alt('f'), alt('.', '.')];

/** Long-press on an arrow: the navigation keys. */
export const ARROW_POPUP: readonly PopupEntry[] = [
  plain('Home', 'Home'),
  plain('End', 'End'),
  plain('PageUp', 'PgUp'),
  plain('PageDown', 'PgDn'),
];
