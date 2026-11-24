import { describe, it, expect, vi } from 'vitest';
import { createModifierStore, DOUBLE_TAP_MS } from './modifierState';

function storeWithClock() {
  let t = 1000;
  const store = createModifierStore({ now: () => t });
  return { store, advance: (ms: number) => { t += ms; } };
}

describe('createModifierStore (#166)', () => {
  it('starts with every modifier off', () => {
    const { store } = storeWithClock();
    expect(store.getSnapshot()).toEqual({ ctrl: 'off', shift: 'off', alt: 'off', meta: 'off' });
    expect(store.hasActive()).toBe(false);
  });

  it('tap arms; a later second tap turns it off', () => {
    const { store, advance } = storeWithClock();
    expect(store.tap('ctrl')).toBe('armed');
    advance(DOUBLE_TAP_MS + 1);
    expect(store.tap('ctrl')).toBe('off');
  });

  it('a double-tap within the window locks; a tap while locked turns it off', () => {
    const { store, advance } = storeWithClock();
    store.tap('ctrl');
    advance(DOUBLE_TAP_MS);
    expect(store.tap('ctrl')).toBe('locked');
    advance(5000);
    expect(store.getSnapshot().ctrl).toBe('locked');
    expect(store.tap('ctrl')).toBe('off');
  });

  it('a third quick tap after locking turns it off (no re-lock loop)', () => {
    const { store, advance } = storeWithClock();
    store.tap('alt');
    advance(100);
    store.tap('alt');
    advance(100);
    expect(store.tap('alt')).toBe('off');
    advance(100);
    expect(store.tap('alt')).toBe('armed');
  });

  it('consume returns the active modifiers and releases only the armed ones', () => {
    const { store, advance } = storeWithClock();
    store.tap('ctrl');
    advance(100);
    store.tap('ctrl'); // locked
    store.tap('alt'); // armed
    expect(store.consume()).toEqual({ ctrl: true, alt: true });
    expect(store.getSnapshot()).toMatchObject({ ctrl: 'locked', alt: 'off' });
    expect(store.consume()).toEqual({ ctrl: true });
    expect(store.consume()).toEqual({ ctrl: true });
  });

  it('modifiers combine', () => {
    const { store } = storeWithClock();
    store.tap('ctrl');
    store.tap('shift');
    expect(store.consume()).toEqual({ ctrl: true, shift: true });
    expect(store.hasActive()).toBe(false);
  });

  it('consume with nothing active is empty and does not notify', () => {
    const { store } = storeWithClock();
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.consume()).toEqual({});
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const { store } = storeWithClock();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.tap('ctrl');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.tap('ctrl');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('releaseArmed keeps locks; clear turns everything off', () => {
    const { store, advance } = storeWithClock();
    store.tap('ctrl');
    advance(50);
    store.tap('ctrl');
    store.tap('alt');
    store.releaseArmed();
    expect(store.getSnapshot()).toMatchObject({ ctrl: 'locked', alt: 'off' });
    store.clear();
    expect(store.hasActive()).toBe(false);
  });

  it('consumeArmed returns and releases only the one-shots (#170)', () => {
    const { store, advance } = storeWithClock();
    store.tap('ctrl');
    advance(50);
    store.tap('ctrl');
    expect(store.hasArmed()).toBe(false);
    expect(store.consumeArmed()).toEqual({});
    store.tap('alt');
    expect(store.hasArmed()).toBe(true);
    expect(store.consumeArmed()).toEqual({ alt: true });
    expect(store.getSnapshot()).toMatchObject({ ctrl: 'locked', alt: 'off' });
  });

  it('keeps a stable snapshot object while nothing changes', () => {
    const { store } = storeWithClock();
    const a = store.getSnapshot();
    store.releaseArmed();
    expect(store.getSnapshot()).toBe(a);
  });
});
