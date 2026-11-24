import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { DASHBOARD_REFRESH_MS, useDashboardSummary } from '../../hooks/useDashboardSummary';
import { getDashboardSummary } from '../../services/dashboard-api';
import { makeDashboardSummary } from '../components/home/dashboardFixtures';

vi.mock('../../services/dashboard-api', () => ({ getDashboardSummary: vi.fn() }));
const fetchSummary = vi.mocked(getDashboardSummary);

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('useDashboardSummary', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSummary.mockReset().mockResolvedValue(makeDashboardSummary());
    setVisibility('visible');
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('loads once on mount', async () => {
    const { result } = renderHook(() => useDashboardSummary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.summary?.sessions.active).toBe(5);
    expect(fetchSummary).toHaveBeenCalledTimes(1);
  });

  it('refreshes every 30 s while visible, and not while hidden', async () => {
    renderHook(() => useDashboardSummary());
    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DASHBOARD_REFRESH_MS);
    });
    expect(fetchSummary).toHaveBeenCalledTimes(2);

    act(() => setVisibility('hidden'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DASHBOARD_REFRESH_MS * 3);
    });
    expect(fetchSummary).toHaveBeenCalledTimes(2);

    // Coming back into view refreshes at once.
    await act(async () => {
      setVisibility('visible');
    });
    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(3));
  });

  it('refreshes on window focus', async () => {
    renderHook(() => useDashboardSummary());
    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(1));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
  });

  it('keeps the last summary when a refresh fails, and reports the error', async () => {
    const { result } = renderHook(() => useDashboardSummary());
    await waitFor(() => expect(result.current.summary).not.toBeNull());
    fetchSummary.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBe('offline');
    expect(result.current.summary).not.toBeNull();
  });

  it('stops refreshing once unmounted', async () => {
    const { unmount } = renderHook(() => useDashboardSummary());
    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DASHBOARD_REFRESH_MS * 2);
      window.dispatchEvent(new Event('focus'));
    });
    expect(fetchSummary).toHaveBeenCalledTimes(1);
  });
});
