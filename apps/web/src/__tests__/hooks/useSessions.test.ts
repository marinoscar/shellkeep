import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSessions } from '../../hooks/useSessions';

// Mock the API service
vi.mock('../../services/api', () => ({
  getSessions: vi.fn(),
  createSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
}));

import {
  getSessions,
  createSession,
  updateSession,
  deleteSession,
} from '../../services/api';

import type { TerminalSession, SessionsResponse, CreateSessionData } from '../../types';

const mockSession: TerminalSession = {
  id: 'session-1',
  name: 'My Session',
  status: 'active',
  tmuxSessionId: 'tmux-abc',
  cols: 80,
  rows: 24,
  lastActivityAt: new Date().toISOString(),
  terminatedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  serverProfile: {
    id: 'profile-1',
    name: 'Dev Server',
    hostname: 'dev.example.com',
    port: 22,
    username: 'deploy',
  },
};

const mockSession2: TerminalSession = {
  id: 'session-2',
  name: 'Second Session',
  status: 'detached',
  tmuxSessionId: 'tmux-def',
  cols: 120,
  rows: 40,
  lastActivityAt: new Date().toISOString(),
  terminatedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  serverProfile: {
    id: 'profile-2',
    name: 'Staging Server',
    hostname: 'staging.example.com',
    port: 2222,
    username: 'admin',
  },
};

const mockSessionsResponse: SessionsResponse = {
  data: [mockSession, mockSession2],
  total: 2,
  page: 1,
  pageSize: 10,
};

describe('useSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSessions).mockResolvedValue(mockSessionsResponse);
    vi.mocked(createSession).mockResolvedValue(mockSession);
    vi.mocked(updateSession).mockResolvedValue(mockSession);
    vi.mocked(deleteSession).mockResolvedValue(undefined);
  });

  describe('Initial State', () => {
    it('should start with empty sessions and default values', () => {
      const { result } = renderHook(() => useSessions());

      expect(result.current.sessions).toEqual([]);
      expect(result.current.total).toBe(0);
      expect(result.current.page).toBe(1);
      expect(result.current.pageSize).toBe(10);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.statusFilter).toBe('all');
    });

    it('should provide all expected methods', () => {
      const { result } = renderHook(() => useSessions());

      expect(typeof result.current.fetchSessions).toBe('function');
      expect(typeof result.current.createNewSession).toBe('function');
      expect(typeof result.current.renameSession).toBe('function');
      expect(typeof result.current.terminateSession).toBe('function');
      expect(typeof result.current.setStatusFilter).toBe('function');
    });
  });

  describe('Fetch on Mount', () => {
    it('should fetch sessions on mount', async () => {
      const { result } = renderHook(() => useSessions());

      await waitFor(() => {
        expect(result.current.sessions).toEqual([mockSession, mockSession2]);
      });

      expect(getSessions).toHaveBeenCalledWith({ status: 'all' });
      expect(result.current.total).toBe(2);
      expect(result.current.page).toBe(1);
      expect(result.current.pageSize).toBe(10);
      expect(result.current.isLoading).toBe(false);
    });

    it('should set error when fetch fails', async () => {
      vi.mocked(getSessions).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useSessions());

      await waitFor(() => {
        expect(result.current.error).toBe('Network error');
      });

      expect(result.current.sessions).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });

    it('should set generic error for non-Error exceptions', async () => {
      vi.mocked(getSessions).mockRejectedValue('unknown error');

      const { result } = renderHook(() => useSessions());

      await waitFor(() => {
        expect(result.current.error).toBe('Failed to fetch sessions');
      });
    });
  });

  describe('fetchSessions', () => {
    it('should call API with custom params', async () => {
      const { result } = renderHook(() => useSessions());

      await waitFor(() => {
        expect(result.current.sessions.length).toBe(2);
      });

      await act(async () => {
        await result.current.fetchSessions({ page: 2, pageSize: 5 });
      });

      expect(getSessions).toHaveBeenCalledWith({
        page: 2,
        pageSize: 5,
        status: 'all',
      });
    });

    it('should use provided status param over current filter', async () => {
      const { result } = renderHook(() => useSessions());

      await waitFor(() => {
        expect(result.current.sessions.length).toBe(2);
      });

      await act(async () => {
        await result.current.fetchSessions({ status: 'active' });
      });

      expect(getSessions).toHaveBeenCalledWith({ status: 'active' });
    });
  });

  describe('createNewSession', () => {
    it('should call createSession API and refresh list', async () => {
      const { result } = renderHook(() => useSessions());

      await waitFor(() => {
        expect(result.current.sessions.length).toBe(2);
      });

      const data: CreateSessionData = {
        serverProfileId: 'profile-1',
        name: 'New Session',
      };

      await act(async () => {
        const session = await result.current.createNewSession(data);
        expect(session).toEqual(mockSession);
      });

      expect(createSession).toHaveBeenCalledWith(data);
      // Should have called getSessions again after create (initial + refresh)
      expect(getSessions).toHaveBeenCalledTimes(2);
    });

    it('should set error when create fails', async () => {
      vi.mocked(createSession).mockRejectedValue(new Error('Create failed'));

      const { result } = renderHook(() => useSessions());

      await waitFor(() => {
        expect(result.current.sessions.length).toBe(2);
      });

      await act(async () => {
        await expect(
          result.current.createNewSession({ serverProfileId: 'profile-1' }),
        ).rejects.toThrow('Create failed');
      });

      expect(result.current.error).toBe('Create failed');
    });
  });

  describe('terminateSession', () => {
    it('should call deleteSession API and refresh list', async () => {
      const { result } = renderHook(() => useSessions());

      await waitFor(() => {
        expect(result.current.sessions.length).toBe(2);
      });

      await act(async () => {
        await result.current.terminateSession('session-1');
      });

      expect(deleteSession).toHaveBeenCalledWith('session-1');
      // Initial fetch + refresh after terminate
      expect(getSessions).toHaveBeenCalledTimes(2);
    });

    it('should set error when terminate fails', async () => {
      vi.mocked(deleteSession).mockRejectedValue(new Error('Terminate failed'));

      const { result } = renderHook(() => useSessions());

      await waitFor(() => {
        expect(result.current.sessions.length).toBe(2);
      });

      await act(async () => {
        await expect(
          result.current.terminateSession('session-1'),
        ).rejects.toThrow('Terminate failed');
      });

      expect(result.current.error).toBe('Terminate failed');
    });
  });

  describe('renameSession', () => {
    it('should call updateSession API and refresh list', async () => {
      const { result } = renderHook(() => useSessions());

      await waitFor(() => {
        expect(result.current.sessions.length).toBe(2);
      });

      await act(async () => {
        await result.current.renameSession('session-1', 'Renamed');
      });

      expect(updateSession).toHaveBeenCalledWith('session-1', { name: 'Renamed' });
      expect(getSessions).toHaveBeenCalledTimes(2);
    });
  });

  describe('Status Filter', () => {
    it('should refetch when status filter changes', async () => {
      const { result } = renderHook(() => useSessions());

      await waitFor(() => {
        expect(result.current.sessions.length).toBe(2);
      });

      // Clear mock count from initial fetch
      vi.mocked(getSessions).mockClear();
      vi.mocked(getSessions).mockResolvedValue({
        data: [mockSession],
        total: 1,
        page: 1,
        pageSize: 10,
      });

      act(() => {
        result.current.setStatusFilter('active');
      });

      await waitFor(() => {
        expect(getSessions).toHaveBeenCalledWith({ status: 'active' });
      });
    });
  });
});
