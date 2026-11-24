import { useState, useSyncExternalStore } from 'react';
import {
  createModifierStore,
  type ModifierSnapshot,
  type ModifierStore,
  type ModifierStoreOptions,
} from '../lib/terminal/keys/modifierState';

export interface UseModifierStateResult {
  /** The status of each modifier (`off | armed | locked`); re-renders on change. */
  state: ModifierSnapshot;
  /** The store itself, for code that reads it outside a render (the terminal's input). */
  store: ModifierStore;
  tap: ModifierStore['tap'];
  consume: ModifierStore['consume'];
  releaseArmed: ModifierStore['releaseArmed'];
  clear: ModifierStore['clear'];
}

/**
 * The key bar's modifiers (#166): Ctrl, Alt, Shift and Meta as one-shots
 * (tap), locks (double-tap) or off. One store per caller, kept for its
 * lifetime; `consume()` returns the active modifiers and releases the armed
 * ones (see `lib/terminal/keys/modifierState.ts`).
 */
export function useModifierState(options?: ModifierStoreOptions): UseModifierStateResult {
  const [store] = useState(() => createModifierStore(options));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return {
    state,
    store,
    tap: store.tap,
    consume: store.consume,
    releaseArmed: store.releaseArmed,
    clear: store.clear,
  };
}
