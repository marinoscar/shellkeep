// =============================================================================
// The modifier engine (issue #166, epic #171)
// =============================================================================
//
// Ctrl, Alt, Shift and Meta, each `off | armed | locked`:
//
//   off    --tap-->                                  armed   (a one-shot)
//   armed  --tap within DOUBLE_TAP_MS of arming-->  locked
//   armed  --tap later-->                            off
//   locked --tap-->                                  off
//
// `consume()` is called once per key sent, from ANY source (the phone
// keyboard, the key bar, a pop-up entry): it returns every active modifier and
// turns the armed ones off; locked ones stay until tapped. The modifiers
// combine (Ctrl+Alt). A small external store, not React state, because the
// terminal's `onData` handler reads and consumes it synchronously, outside
// any render; `useModifierState` subscribes components to it.
// =============================================================================

import type { ActiveModifiers } from './encodeKey';
import { KEY_MODIFIERS, type KeyModifier } from './keyModel';

export type ModifierStatus = 'off' | 'armed' | 'locked';

/** The status of each modifier. */
export type ModifierSnapshot = Readonly<Record<KeyModifier, ModifierStatus>>;

/** A second tap within this many ms of the arming tap locks the modifier. */
export const DOUBLE_TAP_MS = 300;

export const ALL_OFF: ModifierSnapshot = Object.freeze({ ctrl: 'off', shift: 'off', alt: 'off', meta: 'off' });

export interface ModifierStore {
  getSnapshot(): ModifierSnapshot;
  subscribe(listener: () => void): () => void;
  /** A tap on a modifier key; returns the modifier's new status. */
  tap(modifier: KeyModifier): ModifierStatus;
  /**
   * A key is being sent: returns the active (armed and locked) modifiers and
   * releases the armed ones. `{}` when none is active.
   */
  consume(): ActiveModifiers;
  /**
   * A HARDWARE key is being sent (#170): returns only the armed one-shots and
   * releases them. Locked modifiers stay locked and are not returned: a lock
   * applies to soft keys only. `{}` when none is armed.
   */
  consumeArmed(): ActiveModifiers;
  /** Turns the armed one-shots off; locked modifiers stay. */
  releaseArmed(): void;
  /** Turns every modifier off. */
  clear(): void;
  /** Whether any modifier is armed or locked. */
  hasActive(): boolean;
  /** Whether any modifier is armed (a one-shot). */
  hasArmed(): boolean;
}

export interface ModifierStoreOptions {
  /** The clock (ms); `Date.now` by default. */
  now?: () => number;
  doubleTapMs?: number;
}

/** A new modifier store with every modifier off. */
export function createModifierStore(options: ModifierStoreOptions = {}): ModifierStore {
  const now = options.now ?? (() => Date.now());
  const doubleTapMs = options.doubleTapMs ?? DOUBLE_TAP_MS;
  let snapshot: ModifierSnapshot = ALL_OFF;
  const armedAt: Partial<Record<KeyModifier, number>> = {};
  const listeners = new Set<() => void>();

  const set = (next: ModifierSnapshot) => {
    if (KEY_MODIFIERS.every((m) => next[m] === snapshot[m])) return;
    snapshot = Object.freeze({ ...next });
    listeners.forEach((listener) => listener());
  };

  const withStatus = (pick: (status: ModifierStatus, m: KeyModifier) => ModifierStatus) => {
    const next = { ...snapshot };
    for (const m of KEY_MODIFIERS) next[m] = pick(snapshot[m], m);
    return next;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    tap(modifier) {
      const current = snapshot[modifier];
      const at = now();
      let next: ModifierStatus;
      if (current === 'off') {
        next = 'armed';
        armedAt[modifier] = at;
      } else if (current === 'armed') {
        next = at - (armedAt[modifier] ?? -Infinity) <= doubleTapMs ? 'locked' : 'off';
      } else {
        next = 'off';
      }
      set({ ...snapshot, [modifier]: next });
      return next;
    },
    consume() {
      const active: ActiveModifiers = {};
      for (const m of KEY_MODIFIERS) if (snapshot[m] !== 'off') active[m] = true;
      set(withStatus((status) => (status === 'armed' ? 'off' : status)));
      return active;
    },
    consumeArmed() {
      const armed: ActiveModifiers = {};
      for (const m of KEY_MODIFIERS) if (snapshot[m] === 'armed') armed[m] = true;
      set(withStatus((status) => (status === 'armed' ? 'off' : status)));
      return armed;
    },
    releaseArmed() {
      set(withStatus((status) => (status === 'armed' ? 'off' : status)));
    },
    clear() {
      set(ALL_OFF);
    },
    hasActive: () => KEY_MODIFIERS.some((m) => snapshot[m] !== 'off'),
    hasArmed: () => KEY_MODIFIERS.some((m) => snapshot[m] === 'armed'),
  };
}
