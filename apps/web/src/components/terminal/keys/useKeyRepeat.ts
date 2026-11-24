/**
 * Hold-to-repeat for a repeatable key (issue #168, epic #171): arrows, Home,
 * End, PgUp, PgDn, Delete and Backspace, in the key row and the key panel.
 *
 * - A tap sends once, on release, through the key's normal click (so a swipe
 *   that scrolls the row sends nothing, as for every other key).
 * - Held `REPEAT_DELAY_MS` without sliding off, the key sends once and then
 *   repeats, accelerating from 80 ms to 30 ms per repeat (`createRepeater`).
 *   Release, a cancelled pointer, the pointer leaving the key, a hidden page
 *   and unmount all stop it. The click that ends a hold is swallowed.
 * - The modifiers armed when the hold starts apply to every repeat and are
 *   released when it ends (`KeyHold`); locked ones stay.
 *
 * The pop-up rule (decision): on a repeatable key, HOLD MEANS REPEAT. An
 * arrow's alternatives (Home, End, PgUp, PgDn) open with a short upward swipe
 * on the key (`SWIPE_UP_PX`, mostly vertical), the context menu (right-click),
 * the Menu key or Shift+F10. The platform's own touch long press (which raises
 * `contextmenu` while the finger is down) is ignored, so it never interrupts a
 * repeat. Ctrl and Alt keep their long-press pop-ups (`useLongPress`).
 */
import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { createRepeater, onPageHide, type KeyHold } from '../../../lib/terminal/keys/arrowRepeat';

/** An upward swipe of this many px on an arrow key opens its pop-up. */
export const SWIPE_UP_PX = 20;
/** A finger that slides further than this (px) before the repeat starts is not holding. */
export const HOLD_MOVE_TOLERANCE = 10;

export interface UseKeyRepeatOptions {
  /** Starts a hold over the terminal; `null` when there is no terminal. */
  beginHold: () => KeyHold | null;
  /** Sends the key once through the hold (called at the delay, then per repeat). */
  sendWith: (hold: KeyHold) => void;
  /** Opens the key's pop-up (an arrow's navigation keys). Omitted: no pop-up. */
  onPopup?: (anchor: HTMLElement) => void;
}

export interface KeyRepeatHandlers {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export interface UseKeyRepeatResult {
  handlers: KeyRepeatHandlers;
  /** Call first in the key's `onClick`: `true` when the click ends a hold or a swipe (ignore it). */
  consumeClick: () => boolean;
}

export function useKeyRepeat({ beginHold, sendWith, onPopup }: UseKeyRepeatOptions): UseKeyRepeatResult {
  const latest = useRef({ beginHold, sendWith, onPopup });
  latest.current = { beginHold, sendWith, onPopup };
  const origin = useRef<{ x: number; y: number } | null>(null);
  const hold = useRef<KeyHold | null>(null);
  const swallow = useRef(false);
  const repeater = useRef(
    createRepeater(() => {
      if (!hold.current) {
        hold.current = latest.current.beginHold();
        // The click that ends this press must not send the key once more.
        swallow.current = true;
      }
      if (hold.current) latest.current.sendWith(hold.current);
    }),
  );

  const stop = useCallback(() => {
    repeater.current.stop();
    origin.current = null;
    hold.current?.end();
    hold.current = null;
  }, []);

  useEffect(() => {
    const unsubscribe = onPageHide(stop);
    return () => {
      unsubscribe();
      stop();
    };
  }, [stop]);

  const consumeClick = useCallback(() => {
    const was = swallow.current;
    swallow.current = false;
    return was;
  }, []);

  const openPopup = (anchor: HTMLElement, fromPress: boolean) => {
    stop();
    // A swipe may still end in a click on the key; a right-click or a key press does not.
    swallow.current = fromPress;
    latest.current.onPopup?.(anchor);
  };

  return {
    consumeClick,
    handlers: {
      onPointerDown: (event) => {
        if (event.button !== undefined && event.button > 0) return;
        stop();
        swallow.current = false;
        origin.current = { x: event.clientX, y: event.clientY };
        repeater.current.start();
      },
      onPointerMove: (event) => {
        const start = origin.current;
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (latest.current.onPopup && -dy >= SWIPE_UP_PX && Math.abs(dy) > Math.abs(dx)) {
          openPopup(event.currentTarget, true);
          return;
        }
        // Sliding before the repeat starts is a scroll of the row, not a hold.
        if (!hold.current && Math.hypot(dx, dy) > HOLD_MOVE_TOLERANCE) stop();
      },
      onPointerUp: stop,
      onPointerCancel: stop,
      onPointerLeave: stop,
      onContextMenu: (event) => {
        event.preventDefault();
        // A platform long press while the finger is down: holding repeats, it never opens the pop-up.
        if (origin.current) return;
        if (latest.current.onPopup) openPopup(event.currentTarget, false);
      },
      onKeyDown: (event) => {
        if (!latest.current.onPopup) return;
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          openPopup(event.currentTarget, false);
        }
      },
    },
  };
}
