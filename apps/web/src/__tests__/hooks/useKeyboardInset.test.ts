import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeyboardInset } from '../../hooks/useKeyboardInset';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type VisualViewportStub = {
  height: number;
  offsetTop: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

function makeVisualViewport(height: number, offsetTop = 0): VisualViewportStub {
  return {
    height,
    offsetTop,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

/** Return the handler registered for `eventName` on a stub. */
function captureHandler(
  stub: VisualViewportStub,
  eventName: string,
): (() => void) | undefined {
  const calls = stub.addEventListener.mock.calls as [string, () => void][];
  const match = calls.find(([e]) => e === eventName);
  return match?.[1];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useKeyboardInset', () => {
  let originalVisualViewport: VisualViewport | null;
  let originalInnerHeight: number;

  beforeEach(() => {
    originalVisualViewport = window.visualViewport;
    originalInnerHeight = window.innerHeight;
  });

  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', {
      value: originalVisualViewport,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: originalInnerHeight,
      writable: true,
      configurable: true,
    });
  });

  // -------------------------------------------------------------------------
  it('returns 0 when window.visualViewport is undefined', () => {
    Object.defineProperty(window, 'visualViewport', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useKeyboardInset());

    expect(result.current).toBe(0);
  });

  // -------------------------------------------------------------------------
  it('returns 0 when the computed bottom gap is at or below the 75 px threshold', () => {
    // innerHeight 800, vv.height 760, offsetTop 0  →  800 − (760 + 0) = 40  →  0
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      writable: true,
      configurable: true,
    });
    const vv = makeVisualViewport(760, 0);
    Object.defineProperty(window, 'visualViewport', {
      value: vv,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useKeyboardInset());

    expect(result.current).toBe(0);
  });

  // -------------------------------------------------------------------------
  it('returns 0 when the computed bottom gap equals the threshold exactly (75 px)', () => {
    // innerHeight 800, vv.height 725, offsetTop 0  →  800 − 725 = 75  →  0 (not > 75)
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      writable: true,
      configurable: true,
    });
    const vv = makeVisualViewport(725, 0);
    Object.defineProperty(window, 'visualViewport', {
      value: vv,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useKeyboardInset());

    expect(result.current).toBe(0);
  });

  // -------------------------------------------------------------------------
  it('returns the rounded inset when the computed gap exceeds 75 px', () => {
    // innerHeight 800, vv.height 500, offsetTop 0  →  800 − 500 = 300
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      writable: true,
      configurable: true,
    });
    const vv = makeVisualViewport(500, 0);
    Object.defineProperty(window, 'visualViewport', {
      value: vv,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useKeyboardInset());

    expect(result.current).toBe(300);
  });

  // -------------------------------------------------------------------------
  it('accounts for vv.offsetTop when computing the inset', () => {
    // innerHeight 800, vv.height 500, offsetTop 50  →  800 − (500 + 50) = 250
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      writable: true,
      configurable: true,
    });
    const vv = makeVisualViewport(500, 50);
    Object.defineProperty(window, 'visualViewport', {
      value: vv,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useKeyboardInset());

    expect(result.current).toBe(250);
  });

  // -------------------------------------------------------------------------
  it('updates the returned value when a resize event fires', () => {
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      writable: true,
      configurable: true,
    });
    // Start with keyboard hidden (gap = 40, below threshold)
    const vv = makeVisualViewport(760, 0);
    Object.defineProperty(window, 'visualViewport', {
      value: vv,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useKeyboardInset());
    expect(result.current).toBe(0);

    // Simulate keyboard appearing — shrink the visual viewport
    vv.height = 500;
    const handler = captureHandler(vv, 'resize');
    expect(handler).toBeDefined();

    act(() => {
      handler!();
    });

    expect(result.current).toBe(300);
  });

  // -------------------------------------------------------------------------
  it('updates the returned value when a scroll event fires', () => {
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      writable: true,
      configurable: true,
    });
    const vv = makeVisualViewport(760, 0);
    Object.defineProperty(window, 'visualViewport', {
      value: vv,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useKeyboardInset());
    expect(result.current).toBe(0);

    vv.height = 500;
    const handler = captureHandler(vv, 'scroll');
    expect(handler).toBeDefined();

    act(() => {
      handler!();
    });

    expect(result.current).toBe(300);
  });

  // -------------------------------------------------------------------------
  it('removes resize and scroll listeners on unmount', () => {
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      writable: true,
      configurable: true,
    });
    const vv = makeVisualViewport(500, 0);
    Object.defineProperty(window, 'visualViewport', {
      value: vv,
      writable: true,
      configurable: true,
    });

    const { unmount } = renderHook(() => useKeyboardInset());

    unmount();

    expect(vv.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(vv.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});
