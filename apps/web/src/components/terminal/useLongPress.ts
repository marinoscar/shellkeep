import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';

/** How long a key must be held, without moving, to open its pop-up (#166). */
export const LONG_PRESS_MS = 450;
/** Pixels a press may drift and still count as a long press (a swipe scrolls the bar). */
export const LONG_PRESS_MOVE_TOLERANCE = 10;

export interface LongPressHandlers {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export interface UseLongPressResult {
  /** Spread on the key; inert (and the default context menu kept) without `onLongPress`. */
  handlers: Partial<LongPressHandlers>;
  /**
   * Call first in the key's `onClick`: `true` (and the click must be ignored)
   * when that click ends a long press, so a long press never also taps the key.
   */
  consumeLongPress: () => boolean;
}

/**
 * Long press on a key bar key (#166): held `LONG_PRESS_MS` without moving more
 * than `LONG_PRESS_MOVE_TOLERANCE`, or the context menu (a mouse right-click,
 * the Menu key, Shift+F10, a platform long press). Calls `onLongPress` with the
 * key's element, to anchor a pop-up.
 */
export function useLongPress(onLongPress?: (anchor: HTMLElement) => void): UseLongPressResult {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const callback = useRef(onLongPress);
  callback.current = onLongPress;

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const fire = useCallback(
    (anchor: HTMLElement) => {
      cancel();
      fired.current = true;
      callback.current?.(anchor);
    },
    [cancel],
  );

  const consumeLongPress = useCallback(() => {
    const was = fired.current;
    fired.current = false;
    return was;
  }, []);

  if (!onLongPress) return { handlers: {}, consumeLongPress };

  return {
    consumeLongPress,
    handlers: {
      onPointerDown: (event) => {
        if (event.button !== undefined && event.button > 0) return;
        cancel();
        fired.current = false;
        origin.current = { x: event.clientX, y: event.clientY };
        const anchor = event.currentTarget;
        timer.current = setTimeout(() => fire(anchor), LONG_PRESS_MS);
      },
      onPointerMove: (event) => {
        const start = origin.current;
        if (!start || timer.current === null) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_MOVE_TOLERANCE) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu: (event) => {
        event.preventDefault();
        // A platform long press raises this after our own timer already opened the pop-up.
        if (fired.current) return;
        fire(event.currentTarget);
      },
      onKeyDown: (event) => {
        fired.current = false;
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          fire(event.currentTarget);
        }
      },
    },
  };
}
