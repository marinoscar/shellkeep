// =============================================================================
// Telling a hardware key from a soft-keyboard key (issue #170, epic #171)
// =============================================================================
//
// Browsers do not say where a key came from. What they do say, reliably enough:
//
//   - Android soft keyboards (Gboard, SwiftKey) send `keydown` with
//     `key: 'Unidentified'` (or `'Process'`) and `keyCode: 229`, then the text
//     through `input` events. A composing IME sets `isComposing`.
//   - A physical key carries a physical `code` (`KeyR`, `ArrowLeft`, `F5`).
//
// That alone would misread a soft keyboard that fills `code` in, so callers
// ALSO require that no on-screen keyboard covers the page (`readKeyboardInset`
// is 0): a key that arrives while the soft keyboard is up is treated as soft.
//
// PURE: no DOM access beyond the event passed in.
// =============================================================================

/** The navigation and editing keys that count as "typing" on a hardware keyboard. */
const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  'Escape', 'Tab', 'Enter', 'Backspace', 'Delete', 'Insert',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

/** The parts of a `KeyboardEvent` the classifier reads (a plain object in tests). */
export type KeyEventLike = Pick<KeyboardEvent, 'key' | 'code' | 'keyCode' | 'isComposing'>;

/**
 * Whether the event looks like a physical key: it names a real key and a
 * physical `code`, and is not an IME or soft-keyboard placeholder
 * (`Unidentified`, `Process`, keyCode 229). Modifier keys pressed alone count.
 */
export function looksLikeHardwareKey(event: KeyEventLike): boolean {
  if (event.isComposing) return false;
  if (event.keyCode === 229) return false;
  if (!event.key || event.key === 'Unidentified' || event.key === 'Process' || event.key === 'Dead') return false;
  return typeof event.code === 'string' && event.code !== '' && event.code !== 'Unidentified';
}

/** A printable key (one code point, space included) or a navigation, editing or function key. */
export function isTypingKey(key: string): boolean {
  return Array.from(key).length === 1 || NAVIGATION_KEYS.has(key);
}
