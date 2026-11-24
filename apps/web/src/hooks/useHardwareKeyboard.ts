import { useEffect, useState } from 'react';
import { isTypingKey, looksLikeHardwareKey } from '../lib/terminal/keys/hardwareKeys';
import { readKeyboardInset } from './useKeyboardInset';

/** With no hardware key for this long, the keyboard is assumed gone (detached, folded away). */
export const HARDWARE_KEYBOARD_IDLE_MS = 10 * 60_000;

export interface HardwareKeyboardOptions {
  /** How long without a hardware key before `present` turns off again. */
  idleMs?: number;
  /**
   * Whether this device has a touch screen. Detection only runs on one: a
   * desktop always has a keyboard and needs no detection. Default: read from
   * `navigator.maxTouchPoints` (a capability, not a breakpoint).
   */
  touchCapable?: boolean;
}

export interface HardwareKeyboardState {
  /** A hardware keyboard is in use on this touch device. */
  present: boolean;
}

function deviceHasTouch(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (navigator.maxTouchPoints ?? 0) > 0;
}

/**
 * Whether a hardware keyboard is in use on a touch device (#170). Browsers do
 * not say, so it is inferred:
 *
 * - **present** after a `keydown` of a printable or navigation key that looks
 *   physical (`looksLikeHardwareKey`) while NO on-screen keyboard covers the
 *   page (`readKeyboardInset`, the measure behind `useKeyboardInset`, is 0);
 * - **absent** again after a text input that follows a touch while an
 *   on-screen keyboard is up (the user is typing on the glass), or after
 *   `idleMs` without a hardware key.
 *
 * Listens on `window` in the capture phase, so xterm's handlers (which stop
 * some keys) never hide a key from it. Reads nothing but events and the
 * visual viewport; no breakpoint.
 */
export function useHardwareKeyboard(options: HardwareKeyboardOptions = {}): HardwareKeyboardState {
  const idleMs = options.idleMs ?? HARDWARE_KEYBOARD_IDLE_MS;
  const touchCapable = options.touchCapable ?? deviceHasTouch();
  const [present, setPresent] = useState(false);

  useEffect(() => {
    if (!touchCapable) {
      setPresent(false);
      return undefined;
    }
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let lastPointer: string | null = null;
    const clearIdle = () => {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = null;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!looksLikeHardwareKey(event) || !isTypingKey(event.key)) return;
      if (readKeyboardInset() > 0) return;
      setPresent(true);
      clearIdle();
      idleTimer = setTimeout(() => {
        idleTimer = null;
        setPresent(false);
      }, idleMs);
    };
    const onPointerDown = (event: PointerEvent) => {
      lastPointer = event.pointerType || null;
    };
    const onTouchStart = () => {
      lastPointer = 'touch';
    };
    const onInput = () => {
      if (lastPointer !== 'touch' || readKeyboardInset() === 0) return;
      clearIdle();
      setPresent(false);
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('touchstart', onTouchStart, true);
    window.addEventListener('input', onInput, true);
    return () => {
      clearIdle();
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('touchstart', onTouchStart, true);
      window.removeEventListener('input', onInput, true);
    };
  }, [touchCapable, idleMs]);

  return { present };
}
