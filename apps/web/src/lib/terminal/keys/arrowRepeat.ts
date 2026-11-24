// =============================================================================
// Arrow repeat and drag (issue #168, epic #171)
// =============================================================================
//
// The timing and the geometry behind three gestures, shared so they feel the
// same everywhere:
//
//   hold-to-repeat   a repeatable key (arrows, Home, End, PgUp, PgDn, Delete,
//                    Backspace) held REPEAT_DELAY_MS sends once and then
//                    repeats, accelerating from 80 ms to 30 ms per repeat;
//   arrow-drag key   press the key and drag: arrows in the dominant direction,
//                    at one of three speed gears chosen by the distance;
//   arrow mode       a long press on the terminal, then the same drag.
//
// `createHeldKeySender` is what every held gesture sends through: it reads the
// armed modifiers once, when the hold starts, applies them to every byte of
// the hold, and releases the one-shots when the hold ends (locked modifiers
// stay). Timers only; no React, no DOM.
// =============================================================================

import { encodeKey, type ActiveModifiers } from './encodeKey';
import { encodeResolvedKey, type ResolvedKey } from './keyRow';
import { KEY_MODIFIERS } from './keyModel';
import type { ModifierSnapshot, ModifierStore } from './modifierState';

/** A held repeatable key starts repeating after this long (ms). */
export const REPEAT_DELAY_MS = 400;
/** The first repeat interval (ms). */
export const REPEAT_START_INTERVAL_MS = 80;
/** The fastest repeat interval (ms). */
export const REPEAT_MIN_INTERVAL_MS = 30;
/** Each repeat is this much faster than the one before (ms), down to the minimum. */
export const REPEAT_ACCELERATION_MS = 5;

/** The interval before repeat `n + 1`, `n` repeats having been sent (80, 75, ... 30 ms). */
export function repeatInterval(n: number): number {
  return Math.max(REPEAT_MIN_INTERVAL_MS, REPEAT_START_INTERVAL_MS - Math.max(0, n) * REPEAT_ACCELERATION_MS);
}

export type ArrowDirection = 'up' | 'down' | 'left' | 'right';

/**
 * The drag gears: from `minDistance` px along the dominant axis, arrows are sent
 * `perSecond` times a second. Below the first gear nothing is sent.
 */
export const DRAG_GEARS = [
  { minDistance: 12, perSecond: 6 },
  { minDistance: 40, perSecond: 15 },
  { minDistance: 80, perSecond: 35 },
] as const;

/** 0 (below the first threshold: idle) to 3 (the fastest). */
export type DragGear = 0 | 1 | 2 | 3;

/** The gear for a distance (px) along the dominant axis. */
export function dragGear(distance: number): DragGear {
  let gear: DragGear = 0;
  DRAG_GEARS.forEach((g, i) => {
    if (distance >= g.minDistance) gear = (i + 1) as DragGear;
  });
  return gear;
}

/** The ms between two arrows at a gear (`Infinity` when idle). */
export function gearInterval(gear: DragGear): number {
  return gear === 0 ? Infinity : 1000 / DRAG_GEARS[gear - 1].perSecond;
}

/** The dominant direction of a drag (screen coordinates: +y is down), `null` with no movement. */
export function dominantDirection(dx: number, dy: number): ArrowDirection | null {
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export interface DragReading {
  direction: ArrowDirection | null;
  gear: DragGear;
}

/** Direction and gear of a drag offset from its origin. */
export function readDrag(dx: number, dy: number): DragReading {
  const direction = dominantDirection(dx, dy);
  return { direction, gear: direction ? dragGear(Math.max(Math.abs(dx), Math.abs(dy))) : 0 };
}

// ---- held keys ----------------------------------------------------------------

/** One held gesture: every byte it sends carries the modifiers armed when it began. */
export interface KeyHold {
  /** Sends a key: a resolved row key, or a catalog id (`left`, `up`, ...). */
  send(key: ResolvedKey | string): void;
  /** The hold is over: the one-shots it used are released (only when it sent something). */
  end(): void;
}

/** The active (armed or locked) modifiers of a snapshot, without consuming them. */
export function activeModifiersOf(snapshot: ModifierSnapshot): ActiveModifiers {
  const active: ActiveModifiers = {};
  for (const m of KEY_MODIFIERS) if (snapshot[m] !== 'off') active[m] = true;
  return active;
}

export interface HeldKeySenderOptions {
  /** The shared modifier store (#166). Absent: no modifiers. */
  modifiers?: Pick<ModifierStore, 'getSnapshot' | 'releaseArmed'> | null;
  /** The terminal's cursor-key mode (DECCKM), read at every send. */
  applicationCursor: () => boolean;
  /** Writes bytes to the terminal. */
  write: (data: string) => void;
  /** Called once when a hold that sent something ends (the workspace refocuses the terminal). */
  onEnd?: () => void;
}

/**
 * A hold over the terminal: the armed modifiers are read now and apply to the
 * whole hold; `end()` releases the one-shots (locked ones stay). A hold that
 * sent nothing (an arrow-drag tap) leaves the modifiers armed for the next key.
 */
export function createHeldKeySender(options: HeldKeySenderOptions): KeyHold {
  const modifiers = options.modifiers ? activeModifiersOf(options.modifiers.getSnapshot()) : {};
  let sent = false;
  let ended = false;
  return {
    send(key) {
      if (ended) return;
      const encodeOptions = { modifiers, applicationCursor: options.applicationCursor() };
      let data: string;
      if (typeof key === 'string') {
        try {
          data = encodeKey(key, encodeOptions);
        } catch {
          data = '';
        }
      } else {
        data = encodeResolvedKey(key, encodeOptions);
      }
      if (!data) return;
      sent = true;
      options.write(data);
    },
    end() {
      if (ended) return;
      ended = true;
      if (!sent) return;
      options.modifiers?.releaseArmed();
      options.onEnd?.();
    },
  };
}

// ---- timers ---------------------------------------------------------------------

export interface Repeater {
  /** Starts: `onTick` after `REPEAT_DELAY_MS`, then at the accelerating interval. */
  start(): void;
  stop(): void;
  readonly running: boolean;
}

/** Hold-to-repeat timing: the first tick after the delay, then accelerating repeats. */
export function createRepeater(onTick: () => void, delayMs = REPEAT_DELAY_MS): Repeater {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let repeats = 0;
  const schedule = (ms: number) => {
    timer = setTimeout(() => {
      onTick();
      if (timer === null) return; // stopped inside onTick
      const n = repeats++;
      schedule(repeatInterval(n));
    }, ms);
  };
  return {
    start() {
      if (timer !== null) return;
      repeats = 0;
      schedule(delayMs);
    },
    stop() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    get running() {
      return timer !== null;
    },
  };
}

export interface DragDriver {
  /** The drag moved to (dx, dy) from its origin. */
  update(dx: number, dy: number): DragReading;
  stop(): void;
  readonly reading: DragReading;
}

/**
 * Sends arrows for a drag: leaving the idle zone sends one arrow at once, then
 * one every `gearInterval(gear)` ms in the current dominant direction. A gear
 * change reschedules the next arrow at the new rate and calls `onGearChange`.
 */
export function createDragDriver(handlers: {
  send: (direction: ArrowDirection) => void;
  onGearChange?: (gear: DragGear, previous: DragGear) => void;
}): DragDriver {
  let reading: DragReading = { direction: null, gear: 0 };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    clear();
    if (reading.gear === 0 || !reading.direction) return;
    timer = setTimeout(tick, gearInterval(reading.gear));
  };
  const tick = () => {
    timer = null;
    if (reading.gear === 0 || !reading.direction) return;
    handlers.send(reading.direction);
    schedule();
  };
  return {
    update(dx, dy) {
      const previous = reading;
      reading = readDrag(dx, dy);
      if (reading.gear !== previous.gear) {
        handlers.onGearChange?.(reading.gear, previous.gear);
        if (previous.gear === 0) tick();
        else schedule();
      }
      return reading;
    },
    stop() {
      clear();
      reading = { direction: null, gear: 0 };
    },
    get reading() {
      return reading;
    },
  };
}

/**
 * Calls `onHide` when the page is hidden (tab switch, app switch, screen off)
 * or unloaded; returns the unsubscribe. Every held gesture stops there.
 */
export function onPageHide(onHide: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const visibility = () => {
    if (document.visibilityState === 'hidden') onHide();
  };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', onHide);
  window.addEventListener('blur', onHide);
  return () => {
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('blur', onHide);
  };
}
