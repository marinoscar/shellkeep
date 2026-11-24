import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useModifierState } from '../../hooks/useModifierState';

describe('useModifierState (#166)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-renders on tap and consume, with double-tap timing on the real clock', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useModifierState());
    act(() => {
      result.current.tap('ctrl');
    });
    expect(result.current.state.ctrl).toBe('armed');
    act(() => {
      vi.advanceTimersByTime(200);
      result.current.tap('ctrl');
    });
    expect(result.current.state.ctrl).toBe('locked');
    act(() => {
      result.current.tap('alt');
    });
    let consumed = {};
    act(() => {
      consumed = result.current.consume();
    });
    expect(consumed).toEqual({ ctrl: true, alt: true });
    expect(result.current.state).toMatchObject({ ctrl: 'locked', alt: 'off' });
  });

  it('two taps further apart than the window arm then release', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useModifierState());
    act(() => {
      result.current.tap('shift');
    });
    act(() => {
      vi.advanceTimersByTime(400);
      result.current.tap('shift');
    });
    expect(result.current.state.shift).toBe('off');
  });

  it('keeps one store across renders', () => {
    const { result, rerender } = renderHook(() => useModifierState());
    const store = result.current.store;
    rerender();
    expect(result.current.store).toBe(store);
  });
});
