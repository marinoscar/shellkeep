import { useState, useCallback, useEffect } from 'react';
import type { TerminalSession, SessionsResponse, CreateSessionData } from '../types';
import {
  getSessions as fetchSessionsApi,
  createSession as createSessionApi,
  updateSession as updateSessionApi,
  deleteSession as deleteSessionApi,
} from '../services/api';

interface UseSessionsResult {
  sessions: TerminalSession[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  error: string | null;
  statusFilter: string;
  fetchSessions: (params?: {
    page?: number;
    pageSize?: number;
    status?: string;
  }) => Promise<void>;
  createNewSession: (data: CreateSessionData) => Promise<TerminalSession>;
  renameSession: (id: string, name: string) => Promise<void>;
  terminateSession: (id: string) => Promise<void>;
  setStatusFilter: (status: string) => void;
}

export function useSessions(): UseSessionsResult {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilterState] = useState<string>('all');

  const fetchSessions = useCallback(
    async (params?: {
      page?: number;
      pageSize?: number;
      status?: string;
    }) => {
      setIsLoading(true);
      setError(null);
      try {
        const response: SessionsResponse = await fetchSessionsApi({
          ...params,
          status: params?.status ?? statusFilter,
        });
        setSessions(response?.data ?? []);
        setTotal(response?.total ?? 0);
        setPage(response?.page ?? 1);
        setPageSize(response?.pageSize ?? 20);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to fetch sessions';
        setError(message);
        setSessions([]);
      } finally {
        setIsLoading(false);
      }
    },
    [statusFilter],
  );

  const createNewSession = useCallback(
    async (data: CreateSessionData): Promise<TerminalSession> => {
      setError(null);
      try {
        const session = await createSessionApi(data);
        await fetchSessions({ page, pageSize });
        return session;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to create session';
        setError(message);
        throw err;
      }
    },
    [fetchSessions, page, pageSize],
  );

  const renameSession = useCallback(
    async (id: string, name: string) => {
      setError(null);
      try {
        await updateSessionApi(id, { name });
        await fetchSessions({ page, pageSize });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to rename session';
        setError(message);
        throw err;
      }
    },
    [fetchSessions, page, pageSize],
  );

  const terminateSession = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await deleteSessionApi(id);
        await fetchSessions({ page, pageSize });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to terminate session';
        setError(message);
        throw err;
      }
    },
    [fetchSessions, page, pageSize],
  );

  const setStatusFilter = useCallback((status: string) => {
    setStatusFilterState(status);
  }, []);

  // Fetch on mount and when statusFilter changes
  useEffect(() => {
    fetchSessions({ status: statusFilter });
  }, [statusFilter, fetchSessions]);

  return {
    sessions,
    total,
    page,
    pageSize,
    isLoading,
    error,
    statusFilter,
    fetchSessions,
    createNewSession,
    renameSession,
    terminateSession,
    setStatusFilter,
  };
}
