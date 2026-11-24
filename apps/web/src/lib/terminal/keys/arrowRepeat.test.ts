import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  REPEAT_DELAY_MS,
  activeModifiersOf,
  createDragDriver,
  createHeldKeySender,
  createRepeater,
  dominantDirection,
  dragGear,
  gearInterval,
  onPageHide,
  readDrag,
  repeatInterval,
} from './arrowRepeat';
import { createModifierStore } from './modifierState';
import { resolveKeyGroups } from './keyRow';
import { DEFAULT_KEY_LAYOUT } from './keyModel';

describe('repeat timing (#168)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('accelerates from 80 ms to 30 ms per repeat', () => {
    expect(repeatInterval(0)).toBe(80);
    expect(repeatInterval(1)).toBe(75);
    expect(repeatInterval(10)).toBe(30);
    expect(repeatInterval(50)).toBe(30);
  });

  it('ticks after the delay, then at the accelerating interval, and stops', () => {
    const tick = vi.fn();
    const repeater = createRepeater(tick);
    repeater.start();
    vi.advanceTimersByTime(REPEAT_DELAY_MS - 1);
    expect(tick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(79);
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(tick).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(75);
    expect(tick).toHaveBeenCalledTimes(3);
    // Far into the hold the rate is one per 30 ms.
    vi.advanceTimersByTime(5000);
    const before = tick.mock.calls.length;
    vi.advanceTimersByTime(300);
    expect(tick.mock.calls.length - before).toBe(10);
    repeater.stop();
    expect(repeater.running).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(tick.mock.calls.length - before).toBe(10);
  });

  it('stops when the tick itself stops it', () => {
    const repeater = createRepeater(() => repeater.stop());
    repeater.start();
    vi.advanceTimersByTime(REPEAT_DELAY_MS);
    expect(repeater.running).toBe(false);
  });
});

describe('drag geometry (#168)', () => {
  it('picks the dominant direction', () => {
    expect(dominantDirection(0, 0)).toBeNull();
    expect(dominantDirection(10, 3)).toBe('right');
    expect(dominantDirection(-10, 3)).toBe('left');
    expect(dominantDirection(2, -9)).toBe('up');
    expect(dominantDirection(2, 9)).toBe('down');
  });

  it('chooses the gear by distance', () => {
    expect(dragGear(11)).toBe(0);
    expect(dragGear(12)).toBe(1);
    expect(dragGear(39)).toBe(1);
    expect(dragGear(40)).toBe(2);
    expect(dragGear(80)).toBe(3);
    expect(dragGear(500)).toBe(3);
    expect(gearInterval(0)).toBe(Infinity);
    expect(Math.round(1000 / gearInterval(1))).toBe(6);
    expect(Math.round(1000 / gearInterval(2))).toBe(15);
    expect(Math.round(1000 / gearInterval(3))).toBe(35);
    expect(readDrag(5, -45)).toEqual({ direction: 'up', gear: 2 });
  });
});

describe('createDragDriver (#168)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends nothing in the idle zone, then arrows at the gear rate, and stops', () => {
    const send = vi.fn();
    const onGearChange = vi.fn();
    const driver = createDragDriver({ send, onGearChange });
    driver.update(5, 0);
    vi.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();

    driver.update(20, 0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith('right');
    expect(onGearChange).toHaveBeenLastCalledWith(1, 0);
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(7); // ~6 a second

    driver.update(0, -100);
    expect(onGearChange).toHaveBeenLastCalledWith(3, 1);
    send.mockClear();
    vi.advanceTimersByTime(1000);
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(34);
    expect(send).toHaveBeenLastCalledWith('up');

    driver.update(0, -50);
    send.mockClear();
    vi.advanceTimersByTime(1000);
    expect(send.mock.calls.length).toBe(15);

    driver.stop();
    send.mockClear();
    vi.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();
    expect(driver.reading).toEqual({ direction: null, gear: 0 });
  });

  it('back in the idle zone stops sending', () => {
    const send = vi.fn();
    const driver = createDragDriver({ send });
    driver.update(-30, 0);
    driver.update(-3, 0);
    send.mockClear();
    vi.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('createHeldKeySender (#168)', () => {
  const arrows = resolveKeyGroups(DEFAULT_KEY_LAYOUT, new Set())
    .flatMap((g) => g.keys)
    .filter((k) => k.repeatable);
  const right = arrows.find((k) => k.catalogId === 'right')!;

  it('applies an armed one-shot to the whole hold and releases it at the end', () => {
    const store = createModifierStore();
    store.tap('ctrl');
    const write = vi.fn();
    const onEnd = vi.fn();
    const hold = createHeldKeySender({ modifiers: store, applicationCursor: () => false, write, onEnd });
    hold.send(right);
    hold.send(right);
    hold.send('left');
    expect(write.mock.calls.map((c) => c[0])).toEqual(['\x1b[1;5C', '\x1b[1;5C', '\x1b[1;5D']);
    expect(store.getSnapshot().ctrl).toBe('armed');
    hold.end();
    expect(store.getSnapshot().ctrl).toBe('off');
    expect(onEnd).toHaveBeenCalledTimes(1);
    hold.send(right);
    expect(write).toHaveBeenCalledTimes(3);
  });

  it('keeps a locked modifier', () => {
    const store = createModifierStore({ now: () => 0 });
    store.tap('alt');
    store.tap('alt');
    const write = vi.fn();
    const hold = createHeldKeySender({ modifiers: store, applicationCursor: () => false, write });
    hold.send('up');
    hold.end();
    expect(write).toHaveBeenCalledWith('\x1b[1;3A');
    expect(store.getSnapshot().alt).toBe('locked');
  });

  it('sends the application cursor form, read at each send', () => {
    let app = true;
    const write = vi.fn();
    const hold = createHeldKeySender({ applicationCursor: () => app, write });
    hold.send('down');
    app = false;
    hold.send('down');
    expect(write.mock.calls.map((c) => c[0])).toEqual(['\x1bOB', '\x1b[B']);
  });

  it('a hold that sent nothing leaves the modifiers armed', () => {
    const store = createModifierStore();
    store.tap('shift');
    const onEnd = vi.fn();
    createHeldKeySender({ modifiers: store, applicationCursor: () => false, write: vi.fn(), onEnd }).end();
    expect(store.getSnapshot().shift).toBe('armed');
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('reads the active modifiers without consuming them', () => {
    expect(activeModifiersOf({ ctrl: 'armed', alt: 'locked', shift: 'off', meta: 'off' })).toEqual({
      ctrl: true,
      alt: true,
    });
  });
});

describe('onPageHide (#168)', () => {
  it('fires on a hidden page, pagehide and blur, until unsubscribed', () => {
    const hide = vi.fn();
    const off = onPageHide(hide);
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('blur'));
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(hide).toHaveBeenCalledTimes(3);
    off();
    window.dispatchEvent(new Event('pagehide'));
    expect(hide).toHaveBeenCalledTimes(3);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
});
