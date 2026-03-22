import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useServerProfiles } from '../../hooks/useServerProfiles';

// Mock the API service
vi.mock('../../services/api', () => ({
  getServerProfiles: vi.fn(),
  createServerProfile: vi.fn(),
  updateServerProfile: vi.fn(),
  deleteServerProfile: vi.fn(),
  testServerProfile: vi.fn(),
}));

import {
  getServerProfiles,
  createServerProfile,
  updateServerProfile,
  deleteServerProfile,
  testServerProfile,
} from '../../services/api';

import type {
  ServerProfile,
  ServerProfileFormData,
  ServerProfilesResponse,
  TestConnectionResult,
} from '../../types';

const mockProfile: ServerProfile = {
  id: 'profile-1',
  name: 'Dev Server',
  hostname: 'dev.example.com',
  port: 22,
  username: 'deploy',
  authMethod: 'key',
  hasPassword: false,
  hasPrivateKey: true,
  hasPassphrase: false,
  fingerprint: 'SHA256:abc123',
  tags: ['dev', 'linux'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockProfile2: ServerProfile = {
  id: 'profile-2',
  name: 'Staging Server',
  hostname: 'staging.example.com',
  port: 2222,
  username: 'admin',
  authMethod: 'password',
  hasPassword: true,
  hasPrivateKey: false,
  hasPassphrase: false,
  fingerprint: null,
  tags: ['staging'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockProfilesResponse: ServerProfilesResponse = {
  data: [mockProfile, mockProfile2],
  total: 2,
  page: 1,
  pageSize: 10,
};

describe('useServerProfiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerProfiles).mockResolvedValue(mockProfilesResponse);
    vi.mocked(createServerProfile).mockResolvedValue(mockProfile);
    vi.mocked(updateServerProfile).mockResolvedValue(mockProfile);
    vi.mocked(deleteServerProfile).mockResolvedValue(undefined);
    vi.mocked(testServerProfile).mockResolvedValue({ success: true });
  });

  describe('Initial State', () => {
    it('should start with empty profiles and default values', () => {
      const { result } = renderHook(() => useServerProfiles());

      expect(result.current.profiles).toEqual([]);
      expect(result.current.total).toBe(0);
      expect(result.current.page).toBe(1);
      expect(result.current.pageSize).toBe(10);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('should provide all expected methods', () => {
      const { result } = renderHook(() => useServerProfiles());

      expect(typeof result.current.fetchProfiles).toBe('function');
      expect(typeof result.current.createProfile).toBe('function');
      expect(typeof result.current.updateProfile).toBe('function');
      expect(typeof result.current.deleteProfile).toBe('function');
      expect(typeof result.current.testConnection).toBe('function');
    });
  });

  describe('fetchProfiles', () => {
    it('should fetch profiles and update state', async () => {
      const { result } = renderHook(() => useServerProfiles());

      await act(async () => {
        await result.current.fetchProfiles();
      });

      expect(getServerProfiles).toHaveBeenCalledWith(undefined);
      expect(result.current.profiles).toEqual([mockProfile, mockProfile2]);
      expect(result.current.total).toBe(2);
      expect(result.current.page).toBe(1);
      expect(result.current.pageSize).toBe(10);
      expect(result.current.isLoading).toBe(false);
    });

    it('should pass params to API', async () => {
      const { result } = renderHook(() => useServerProfiles());

      await act(async () => {
        await result.current.fetchProfiles({ page: 2, pageSize: 5, search: 'dev' });
      });

      expect(getServerProfiles).toHaveBeenCalledWith({
        page: 2,
        pageSize: 5,
        search: 'dev',
      });
    });

    it('should set error when fetch fails', async () => {
      vi.mocked(getServerProfiles).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useServerProfiles());

      await act(async () => {
        await result.current.fetchProfiles();
      });

      expect(result.current.error).toBe('Network error');
      expect(result.current.profiles).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });

    it('should set generic error for non-Error exceptions', async () => {
      vi.mocked(getServerProfiles).mockRejectedValue('unknown');

      const { result } = renderHook(() => useServerProfiles());

      await act(async () => {
        await result.current.fetchProfiles();
      });

      expect(result.current.error).toBe('Failed to fetch server profiles');
    });
  });

  describe('createProfile', () => {
    it('should call API and refresh list', async () => {
      const { result } = renderHook(() => useServerProfiles());

      const formData: ServerProfileFormData = {
        name: 'New Server',
        hostname: 'new.example.com',
        port: 22,
        username: 'root',
        authMethod: 'password',
        password: 'secret',
      };

      await act(async () => {
        await result.current.createProfile(formData);
      });

      expect(createServerProfile).toHaveBeenCalledWith(formData);
      // Refresh after create
      expect(getServerProfiles).toHaveBeenCalledTimes(1);
    });

    it('should set error when create fails', async () => {
      vi.mocked(createServerProfile).mockRejectedValue(new Error('Create failed'));

      const { result } = renderHook(() => useServerProfiles());

      await act(async () => {
        await expect(
          result.current.createProfile({
            name: 'Test',
            hostname: 'test.com',
            port: 22,
            username: 'root',
            authMethod: 'password',
          }),
        ).rejects.toThrow('Create failed');
      });

      expect(result.current.error).toBe('Create failed');
    });
  });

  describe('updateProfile', () => {
    it('should call API with id and data and refresh list', async () => {
      const { result } = renderHook(() => useServerProfiles());

      await act(async () => {
        await result.current.updateProfile('profile-1', { name: 'Updated' });
      });

      expect(updateServerProfile).toHaveBeenCalledWith('profile-1', { name: 'Updated' });
      expect(getServerProfiles).toHaveBeenCalledTimes(1);
    });

    it('should set error when update fails', async () => {
      vi.mocked(updateServerProfile).mockRejectedValue(new Error('Update failed'));

      const { result } = renderHook(() => useServerProfiles());

      await act(async () => {
        await expect(
          result.current.updateProfile('profile-1', { name: 'Updated' }),
        ).rejects.toThrow('Update failed');
      });

      expect(result.current.error).toBe('Update failed');
    });
  });

  describe('deleteProfile', () => {
    it('should call API and refresh list', async () => {
      const { result } = renderHook(() => useServerProfiles());

      await act(async () => {
        await result.current.deleteProfile('profile-1');
      });

      expect(deleteServerProfile).toHaveBeenCalledWith('profile-1');
      expect(getServerProfiles).toHaveBeenCalledTimes(1);
    });

    it('should set error when delete fails', async () => {
      vi.mocked(deleteServerProfile).mockRejectedValue(new Error('Delete failed'));

      const { result } = renderHook(() => useServerProfiles());

      await act(async () => {
        await expect(
          result.current.deleteProfile('profile-1'),
        ).rejects.toThrow('Delete failed');
      });

      expect(result.current.error).toBe('Delete failed');
    });
  });

  describe('testConnection', () => {
    it('should return success result', async () => {
      const testResult: TestConnectionResult = { success: true };
      vi.mocked(testServerProfile).mockResolvedValue(testResult);

      const { result } = renderHook(() => useServerProfiles());

      let connectionResult: TestConnectionResult;
      await act(async () => {
        connectionResult = await result.current.testConnection('profile-1');
      });

      expect(testServerProfile).toHaveBeenCalledWith('profile-1');
      expect(connectionResult!).toEqual({ success: true });
    });

    it('should return failure result on error', async () => {
      vi.mocked(testServerProfile).mockRejectedValue(new Error('Connection refused'));

      const { result } = renderHook(() => useServerProfiles());

      let connectionResult: TestConnectionResult;
      await act(async () => {
        connectionResult = await result.current.testConnection('profile-1');
      });

      expect(connectionResult!).toEqual({
        success: false,
        error: 'Connection refused',
      });
    });

    it('should return generic error for non-Error exceptions', async () => {
      vi.mocked(testServerProfile).mockRejectedValue('unknown');

      const { result } = renderHook(() => useServerProfiles());

      let connectionResult: TestConnectionResult;
      await act(async () => {
        connectionResult = await result.current.testConnection('profile-1');
      });

      expect(connectionResult!).toEqual({
        success: false,
        error: 'Failed to test connection',
      });
    });
  });
});
