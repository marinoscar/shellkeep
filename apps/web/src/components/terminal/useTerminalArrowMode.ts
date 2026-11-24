/**
 * Long-press-and-drag arrow mode on the terminal (issue #168, epic #171).
 *
 * A finger held `ARROW_MODE_LONG_PRESS_MS` on the terminal without moving more
 * than `ARROW_MODE_MOVE_TOLERANCE` enters arrow mode: dragging then sends
 * arrows in the dominant direction at the three speed gears of the arrow-drag
 * key (`createDragDriver`), and lifting the finger ends it. While it lasts the
 * terminal's other touch handlers see no move (the listeners run in the
 * capture phase on the terminal's wrapper and stop the moves there), so
 * `useTouchScroll` does not scroll; it is itself unchanged.
 *
 * - A swipe that moves before the long press fires is a normal scroll: this
 *   hook lets every event through and does nothing.
 * - A long press on an UNDERLINED file link (`isLinkAt`, #155) is the file
 *   menu's: arrow mode declines it. Anywhere else arrow mode claims the
 *   gesture (`isTouchClaimed`), and the file links open nothing.
 * - Touch only: listeners are touch events, so a mouse never enters arrow mode
 *   and desktop text selection is untouched.
 * - A haptic tick on entering and on each gear change, when `haptics` is on.
 * - Release, a second finger, a cancelled touch, a hidden page and unmount
 *   end it; the modifiers armed when it began apply to the whole drag.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  createDragDriver,
  onPageHide,
  type DragDriver,
  type DragReading,
  type KeyHold,
} from '../../lib/terminal/keys/arrowRepeat';
import { hapticTick } from '../../lib/terminal/keys/haptics';

/** How long a finger must rest on the terminal to enter arrow mode (ms). */
export const ARROW_MODE_LONG_PRESS_MS = 350;
/** A finger that moves further than this (px) before that is scrolling. */
export const ARROW_MODE_MOVE_TOLERANCE = 8;

export interface UseTerminalArrowModeOptions {
  /** Off: the hook attaches nothing. */
  enabled: boolean;
  /** Starts a hold over this terminal (its cursor mode, the armed modifiers). */
  beginHold: () => KeyHold | null;
  haptics: boolean;
  /** An underlined file link is at this point: the long press is the file menu's. */
  isLinkAt?: (x: number, y: number) => boolean;
}

export interface UseTerminalArrowModeResult {
  /** The live direction and gear while arrow mode is on; `null` otherwise. */
  state: DragReading | null;
  /** Whether arrow mode took the current (or last) touch gesture. */
  isTouchClaimed: () => boolean;
}

export function useTerminalArrowMode(
  /** Where the listeners go (capture phase): an ancestor of the xterm host. */
  wrapperRef: RefObject<HTMLElement | null>,
  /** The xterm host: only touches that start inside it count. */
  containerRef: RefObject<HTMLElement | null>,
  options: UseTerminalArrowModeOptions,
): UseTerminalArrowModeResult {
  const latest = useRef(options);
  latest.current = options;
  const [state, setState] = useState<DragReading | null>(null);
  const claimed = useRef(false);

  const isTouchClaimed = useCallback(() => claimed.current, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !options.enabled) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let origin: { x: number; y: number } | null = null;
    let driver: DragDriver | null = null;
    let hold: KeyHold | null = null;

    const cancelPending = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const finish = () => {
      cancelPending();
      if (!driver) return;
      driver.stop();
      driver = null;
      hold?.end();
      hold = null;
      setState(null);
    };

    const enter = () => {
      timer = null;
      const at = origin;
      if (!at) return;
      if (latest.current.isLinkAt?.(at.x, at.y)) return; // the file menu's long press
      claimed.current = true;
      hapticTick(latest.current.haptics);
      driver = createDragDriver({
        send: (direction) => {
          hold ??= latest.current.beginHold();
          hold?.send(direction);
        },
        onGearChange: (gear) => {
          if (gear > 0) hapticTick(latest.current.haptics);
        },
      });
      setState({ direction: null, gear: 0 });
    };

    const onTouchStart = (event: TouchEvent) => {
      finish();
      claimed.current = false;
      origin = null;
      const touch = event.touches[0];
      const container = containerRef.current;
      if (event.touches.length !== 1 || !touch || !container) return;
      if (!(event.target instanceof Node) || !container.contains(event.target)) return;
      origin = { x: touch.clientX, y: touch.clientY };
      timer = setTimeout(enter, ARROW_MODE_LONG_PRESS_MS);
    };

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (driver) {
        // Arrow mode owns the gesture: no scroll, no link handling.
        event.stopPropagation();
        if (event.cancelable) event.preventDefault();
        if (event.touches.length !== 1 || !touch || !origin) {
          finish();
          return;
        }
        const next = driver.update(touch.clientX - origin.x, touch.clientY - origin.y);
        setState((prev) => (prev && prev.direction === next.direction && prev.gear === next.gear ? prev : next));
        return;
      }
      if (timer === null || !origin) return;
      if (event.touches.length !== 1 || !touch) {
        cancelPending();
        return;
      }
      if (Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y) > ARROW_MODE_MOVE_TOLERANCE) {
        cancelPending(); // a swipe: useTouchScroll scrolls
      }
    };

    const onTouchEnd = () => {
      // `claimed` stays set until the next touch, so the file links (after us) see it.
      finish();
    };

    wrapper.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    wrapper.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    wrapper.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    wrapper.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });
    const unsubscribe = onPageHide(finish);
    return () => {
      unsubscribe();
      finish();
      wrapper.removeEventListener('touchstart', onTouchStart, { capture: true });
      wrapper.removeEventListener('touchmove', onTouchMove, { capture: true });
      wrapper.removeEventListener('touchend', onTouchEnd, { capture: true });
      wrapper.removeEventListener('touchcancel', onTouchEnd, { capture: true });
    };
  }, [wrapperRef, containerRef, options.enabled]);

  return { state, isTouchClaimed };
}
