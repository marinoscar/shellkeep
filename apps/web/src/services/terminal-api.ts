import { api, ApiError, API_BASE_URL } from './api';
import type {
  ServerProfilesResponse,
  ServerProfile,
  ServerProfileFormData,
  TestConnectionResult,
  HostKeyScanResult,
  ServerFactsRefreshResult,
  SessionsResponse,
  TerminalSession,
  CreateSessionData,
} from '../types/terminal';

// Terminal domain API: server profiles and terminal sessions. Built on the base
// `api` client; the base `services/api.ts` names none of these routes.

// Server Profiles API
export async function getServerProfiles(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<ServerProfilesResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params?.search) searchParams.set('search', params.search);
  const query = searchParams.toString();
  return api.get<ServerProfilesResponse>(`/server-profiles${query ? `?${query}` : ''}`);
}

export async function getServerProfile(id: string): Promise<ServerProfile> {
  return api.get<ServerProfile>(`/server-profiles/${id}`);
}

export async function createServerProfile(
  data: ServerProfileFormData,
): Promise<ServerProfile> {
  return api.post<ServerProfile>('/server-profiles', data);
}

export async function updateServerProfile(
  id: string,
  data: Partial<ServerProfileFormData>,
): Promise<ServerProfile> {
  return api.patch<ServerProfile>(`/server-profiles/${id}`, data);
}

export async function deleteServerProfile(id: string): Promise<void> {
  await api.delete<void>(`/server-profiles/${id}`);
}

export async function testServerProfile(
  id: string,
): Promise<TestConnectionResult> {
  return api.post<TestConnectionResult>(`/server-profiles/${id}/test`);
}

// Host keys (#60). Bodyless POST/DELETE: the client sends no Content-Type
// without a body, which Fastify requires.

/** Read the key the server presents now; sends no credential, stores nothing. */
export async function scanHostKey(id: string): Promise<HostKeyScanResult> {
  return api.post<HostKeyScanResult>(`/server-profiles/${id}/host-key/scan`);
}

/**
 * Trust the key the server presents, provided it is `fingerprint` (409
 * `HOST_KEY_CHANGED_DURING_TRUST` otherwise). Replacing a different trusted key
 * also needs `confirmHostname` equal to the profile's hostname.
 */
export async function trustHostKey(
  id: string,
  fingerprint: string,
  confirmHostname?: string,
): Promise<ServerProfile> {
  return api.post<ServerProfile>(`/server-profiles/${id}/host-key/trust`, {
    fingerprint,
    ...(confirmHostname !== undefined ? { confirmHostname } : {}),
  });
}

/** Forget the trusted key; the next connect prompts again. */
export async function forgetHostKey(id: string): Promise<ServerProfile> {
  return api.delete<ServerProfile>(`/server-profiles/${id}/host-key`);
}

/** Probe the server's facts again (409 HOST_KEY_* when the key is not trusted). */
export async function refreshServerFacts(id: string): Promise<ServerFactsRefreshResult> {
  return api.post<ServerFactsRefreshResult>(`/server-profiles/${id}/facts/refresh`);
}

// Terminal Sessions API
export async function getSessions(params?: {
  page?: number;
  pageSize?: number;
  status?: string;
}): Promise<SessionsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.pageSize) searchParams.set('pageSize', String(params.pageSize));
  if (params?.status && params.status !== 'all') searchParams.set('status', params.status);
  const query = searchParams.toString();
  return api.get<SessionsResponse>(`/sessions${query ? `?${query}` : ''}`);
}

export async function getSession(id: string): Promise<TerminalSession> {
  return api.get<TerminalSession>(`/sessions/${id}`);
}

export async function createSession(data: CreateSessionData): Promise<TerminalSession> {
  return api.post<TerminalSession>('/sessions', data);
}

export async function updateSession(
  id: string,
  data: { name: string },
): Promise<TerminalSession> {
  return api.patch<TerminalSession>(`/sessions/${id}`, data);
}

export async function deleteSession(id: string): Promise<void> {
  await api.delete<void>(`/sessions/${id}`);
}

export async function batchTerminateSessions(ids: string[]): Promise<{ terminated: number }> {
  return api.post<{ terminated: number }>('/sessions/batch-terminate', { ids });
}

// Session history
export async function downloadSessionHistory(sessionId: string): Promise<Blob> {
  const token = api.getAccessToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/history`, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (response.status === 401) {
    const refreshed = await api.refreshToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${api.getAccessToken()}`;
      const retryResponse = await fetch(`${API_BASE_URL}/sessions/${sessionId}/history`, {
        method: 'GET',
        headers,
        credentials: 'include',
      });
      if (!retryResponse.ok) {
        const error = await retryResponse.json().catch(() => ({}));
        throw new ApiError(error.message || 'Failed to download history', retryResponse.status, error.code, error.details);
      }
      return retryResponse.blob();
    }
    throw new ApiError('Unauthorized', 401);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(error.message || 'Failed to download history', response.status, error.code, error.details);
  }

  return response.blob();
}

// Terminal AI consent (#56). The routes sit under /api/ai/*: `ai:use` and the AI kill switch apply.

export interface TerminalAiConsentState {
  /** Whether the deployment or organization requires consent before terminal output reaches AI. */
  required: boolean;
  /** When this user accepted (ISO), or `null`. */
  consentAcceptedAt: string | null;
  redactionMode: 'standard' | 'strict';
}

export async function getTerminalAiConsent(): Promise<TerminalAiConsentState> {
  return api.get<TerminalAiConsentState>('/ai/terminal/consent');
}

export async function acceptTerminalAiConsent(): Promise<{ consentAcceptedAt: string }> {
  return api.post<{ consentAcceptedAt: string }>('/ai/terminal/consent', {});
}
