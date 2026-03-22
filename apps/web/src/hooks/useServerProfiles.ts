import { useState, useCallback } from 'react';
import type {
  ServerProfile,
  ServerProfileFormData,
  ServerProfilesResponse,
  TestConnectionResult,
} from '../types';
import {
  getServerProfiles as fetchProfilesApi,
  createServerProfile as createProfileApi,
  updateServerProfile as updateProfileApi,
  deleteServerProfile as deleteProfileApi,
  testServerProfile as testProfileApi,
} from '../services/api';

interface UseServerProfilesResult {
  profiles: ServerProfile[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  error: string | null;
  fetchProfiles: (params?: {
    page?: number;
    pageSize?: number;
    search?: string;
  }) => Promise<void>;
  createProfile: (data: ServerProfileFormData) => Promise<void>;
  updateProfile: (
    id: string,
    data: Partial<ServerProfileFormData>,
  ) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  testConnection: (id: string) => Promise<TestConnectionResult>;
}

export function useServerProfiles(): UseServerProfilesResult {
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfiles = useCallback(
    async (params?: {
      page?: number;
      pageSize?: number;
      search?: string;
    }) => {
      setIsLoading(true);
      setError(null);
      try {
        const response: ServerProfilesResponse =
          await fetchProfilesApi(params);
        setProfiles(response?.data ?? []);
        setTotal(response?.total ?? 0);
        setPage(response?.page ?? 1);
        setPageSize(response?.pageSize ?? 20);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to fetch server profiles';
        setError(message);
        setProfiles([]);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const createProfile = useCallback(
    async (data: ServerProfileFormData) => {
      setError(null);
      try {
        await createProfileApi(data);
        await fetchProfiles({ page, pageSize });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to create server profile';
        setError(message);
        throw err;
      }
    },
    [fetchProfiles, page, pageSize],
  );

  const updateProfile = useCallback(
    async (id: string, data: Partial<ServerProfileFormData>) => {
      setError(null);
      try {
        await updateProfileApi(id, data);
        await fetchProfiles({ page, pageSize });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to update server profile';
        setError(message);
        throw err;
      }
    },
    [fetchProfiles, page, pageSize],
  );

  const deleteProfile = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await deleteProfileApi(id);
        await fetchProfiles({ page, pageSize });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to delete server profile';
        setError(message);
        throw err;
      }
    },
    [fetchProfiles, page, pageSize],
  );

  const testConnection = useCallback(async (id: string) => {
    try {
      return await testProfileApi(id);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to test connection';
      return { success: false, error: message };
    }
  }, []);

  return {
    profiles,
    total,
    page,
    pageSize,
    isLoading,
    error,
    fetchProfiles,
    createProfile,
    updateProfile,
    deleteProfile,
    testConnection,
  };
}
