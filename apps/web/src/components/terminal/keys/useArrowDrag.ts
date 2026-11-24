/**
 * The arrow-drag key (issue #168, epic #171): press the key and drag in any
 * direction; arrows are sent in the dominant direction at three speed gears by
 * distance (`DRAG_GEARS`: ~12 px slow, ~40 px medium, ~80 px fast). Release,
 * a cancelled pointer or a hidden page stops it. The pointer is captured, so
 * the drag keeps going after the finger leaves the small key. A press without
 * a drag sends nothing and shows a hint.
 *
 * Bytes go through a `KeyHold`: the cursor-key mode of the terminal and the
 * modifiers armed when the press began, released when it ends.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import {
  createDragDriver,
  onPageHide,
  type DragDriver,
  type DragReading,
  type KeyHold,
} from '../../../lib/terminal/keys/arrowRepeat';
import { hapticTick } from '../../../lib/terminal/keys/haptics';

const IDLE: DragReading = { direction: null, gear: 0 };

export interface UseArrowDragOptions {
  /** Starts a hold over the terminal; `null` when there is no terminal. */
  beginHold: () => KeyHold | null;
  /** A haptic tick on each gear change where supported (`shortcuts.options.haptics`). */
  haptics: boolean;
  /** A press that ended without a drag (or a keyboard activation): show the hint. */
  onTapWithoutDrag: () => void;
}

export interface UseArrowDragResult {
  /** The live direction and gear, for the key's look. */
  reading: DragReading;
  dragging: boolean;
  handlers: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onLostPointerCapture: () => void;
  };
  /** Call first in the key's `onClick`: `true` when a press already handled it. */
  consumeClick: () => boolean;
}

export function useArrowDrag({ beginHold, haptics, onTapWithoutDrag }: UseArrowDragOptions): UseArrowDragResult {
  const latest = useRef({ beginHold, haptics, onTapWithoutDrag });
  latest.current = { beginHold, haptics, onTapWithoutDrag };
  const [reading, setReading] = useState<DragReading>(IDLE);
  const [dragging, setDragging] = useState(false);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const driver = useRef<DragDriver | null>(null);
  const hold = useRef<KeyHold | null>(null);
  const moved = useRef(false);
  const swallow = useRef(false);

  const finish = useCallback((showHint: boolean) => {
    if (!origin.current) return;
    origin.current = null;
    driver.current?.stop();
    driver.current = null;
    hold.current?.end();
    hold.current = null;
    setReading(IDLE);
    setDragging(false);
    if (showHint && !moved.current) latest.current.onTapWithoutDrag();
  }, []);

  useEffect(() => {
    const stop = () => finish(false);
    const unsubscribe = onPageHide(stop);
    return () => {
      unsubscribe();
      stop();
    };
  }, [finish]);

  const consumeClick = useCallback(() => {
    const was = swallow.current;
    swallow.current = false;
    return was;
  }, []);

  return {
    reading,
    dragging,
    consumeClick,
    handlers: {
      onPointerDown: (event) => {
        if (event.button !== undefined && event.button > 0) return;
        finish(false);
        event.preventDefault();
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          // A synthetic or already-released pointer cannot be captured: the drag still works on the key.
        }
        origin.current = { x: event.clientX, y: event.clientY };
        moved.current = false;
        swallow.current = true;
        setDragging(true);
        driver.current = createDragDriver({
          send: (direction) => {
            hold.current ??= latest.current.beginHold();
            hold.current?.send(direction);
          },
          onGearChange: (gear) => {
            if (gear > 0) hapticTick(latest.current.haptics);
          },
        });
      },
      onPointerMove: (event) => {
        const start = origin.current;
        if (!start || !driver.current) return;
        const next = driver.current.update(event.clientX - start.x, event.clientY - start.y);
        if (next.gear > 0) moved.current = true;
        setReading((prev) => (prev.direction === next.direction && prev.gear === next.gear ? prev : next));
      },
      onPointerUp: () => finish(true),
      onPointerCancel: () => finish(false),
      onLostPointerCapture: () => finish(false),
    },
  };
}
