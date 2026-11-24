import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { HARDWARE_KEYBOARD_IDLE_MS, useHardwareKeyboard } from '../../hooks/useHardwareKeyboard';

// =============================================================================
// Hardware keyboard detection (#170): a physical key while the visual viewport
// is NOT shrunk by an on-screen keyboard means a keyboard is attached; typing
// on the glass (a touch, then input with a keyboard inset) or a long idle
// means it is gone. `visualViewport` and the events are mocked.
// =============================================================================

const viewport = { height: 0, offsetTop: 0 };
const original = window.visualViewport;

function onScreenKeyboard(height: number) {
  viewport.height = window.innerHeight - height;
}

function keydown(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });
}

function touchThenType() {
  act(() => {
    window.dispatchEvent(new Event('touchstart'));
    const target = document.createElement('textarea');
    document.body.appendChild(target);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.remove();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  onScreenKeyboard(0);
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      get height() {
        return viewport.height;
      },
      get offsetTop() {
        return viewport.offsetTop;
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: original });
});

describe('useHardwareKeyboard (#170)', () => {
  it('starts absent', () => {
    const { result } = renderHook(() => useHardwareKeyboard({ touchCapable: true }));
    expect(result.current.present).toBe(false);
  });

  it.each([
    ['a letter', { key: 'r', code: 'KeyR' }],
    ['Escape', { key: 'Escape', code: 'Escape' }],
    ['an arrow', { key: 'ArrowLeft', code: 'ArrowLeft' }],
    ['an F-key', { key: 'F5', code: 'F5' }],
    ['a chord', { key: 'r', code: 'KeyR', ctrlKey: true }],
  ])('turns present after %s with no on-screen keyboard', (_name, init) => {
    const { result } = renderHook(() => useHardwareKeyboard({ touchCapable: true }));
    keydown(init);
    expect(result.current.present).toBe(true);
  });

  it('ignores a key while the on-screen keyboard shrinks the viewport', () => {
    onScreenKeyboard(300);
    const { result } = renderHook(() => useHardwareKeyboard({ touchCapable: true }));
    keydown({ key: 'r', code: 'KeyR' });
    expect(result.current.present).toBe(false);
  });

  it('ignores soft-keyboard placeholders and modifier keys alone', () => {
    const { result } = renderHook(() => useHardwareKeyboard({ touchCapable: true }));
    keydown({ key: 'Unidentified', code: '' });
    keydown({ key: 'Process', code: 'KeyA' });
    keydown({ key: 'Shift', code: 'ShiftLeft' });
    keydown({ key: 'a', code: 'KeyA', isComposing: true });
    expect(result.current.present).toBe(false);
  });

  it('never turns present on a device without touch', () => {
    const { result } = renderHook(() => useHardwareKeyboard({ touchCapable: false }));
    keydown({ key: 'r', code: 'KeyR' });
    expect(result.current.present).toBe(false);
  });

  it('reads touch from navigator.maxTouchPoints by default', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'maxTouchPoints');
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
    try {
      const { result } = renderHook(() => useHardwareKeyboard());
      keydown({ key: 'r', code: 'KeyR' });
      expect(result.current.present).toBe(true);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).maxTouchPoints;
      if (descriptor) Object.defineProperty(Navigator.prototype, 'maxTouchPoints', descriptor);
    }
  });

  it('turns absent after a touch-originated input with a keyboard inset', () => {
    const { result } = renderHook(() => useHardwareKeyboard({ touchCapable: true }));
    keydown({ key: 'r', code: 'KeyR' });
    expect(result.current.present).toBe(true);
    onScreenKeyboard(300);
    touchThenType();
    expect(result.current.present).toBe(false);
  });

  it('stays present after an input with no keyboard inset or without a touch', () => {
    const { result } = renderHook(() => useHardwareKeyboard({ touchCapable: true }));
    keydown({ key: 'r', code: 'KeyR' });
    // No inset: the hardware keyboard typed it.
    touchThenType();
    expect(result.current.present).toBe(true);
    // An inset, but the last pointer was a mouse.
    onScreenKeyboard(300);
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse' }));
      window.dispatchEvent(new Event('input'));
    });
    expect(result.current.present).toBe(true);
  });

  it('turns absent after the idle time without hardware keys, each key restarting it', () => {
    const { result } = renderHook(() => useHardwareKeyboard({ touchCapable: true }));
    keydown({ key: 'r', code: 'KeyR' });
    act(() => {
      vi.advanceTimersByTime(HARDWARE_KEYBOARD_IDLE_MS - 1000);
    });
    keydown({ key: 's', code: 'KeyS' });
    act(() => {
      vi.advanceTimersByTime(HARDWARE_KEYBOARD_IDLE_MS - 1000);
    });
    expect(result.current.present).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.present).toBe(false);
  });

  it('honours a custom idle time and stops listening on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { result, unmount } = renderHook(() => useHardwareKeyboard({ touchCapable: true, idleMs: 500 }));
    keydown({ key: 'r', code: 'KeyR' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.present).toBe(false);
    unmount();
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    remove.mockRestore();
  });
});
