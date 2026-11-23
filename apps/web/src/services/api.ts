import {
  ApiError,
  PlatformHttpClient,
  createPlatformApiClient,
  type PlatformHttpRequestOptions,
} from '@marinoscar/platform-web/core';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

/**
 * The package's error class, re-exported so call sites that import `ApiError`
 * from `services/api` keep doing so (same `message`, `status`, `code`,
 * `details`, so an `instanceof` check still matches).
 */
export { ApiError };

/** Request options of {@link api}, for the few callers that name the type. */
export type RequestOptions = PlatformHttpRequestOptions;

/** Called with the new access token after every successful refresh. */
export type AccessTokenRefreshedListener = (token: string) => void;

/**
 * The app's one HTTP client (issue #47): the platform's `PlatformHttpClient`
 * (`@marinoscar/platform-web/core`), which holds the access token in memory,
 * sends it as `Authorization: Bearer`, refreshes once on a 401 from the
 * HttpOnly `refresh_token` cookie and serialises refreshes across tabs. The
 * packaged `AuthProvider` drives sessions through it.
 *
 * The one addition is {@link AppHttpClient.onAccessTokenRefreshed}: long-lived
 * connections that carry the access token outside HTTP (a WebSocket that
 * re-authenticates in-band) subscribe to it so they can present the fresh
 * token. Every refresh goes through `refreshToken()` (the client's own
 * 401-retry calls it too), so overriding it observes all of them.
 */
export class AppHttpClient extends PlatformHttpClient {
  private refreshedListeners = new Set<AccessTokenRefreshedListener>();

  override async refreshToken(): Promise<boolean> {
    const refreshed = await super.refreshToken();
    const token = this.getAccessToken();
    if (refreshed && token) {
      for (const listener of [...this.refreshedListeners]) {
        try {
          listener(token);
        } catch (error) {
          console.error('Access token listener failed:', error);
        }
      }
    }
    return refreshed;
  }

  /**
   * Subscribe to "a new access token is held" (after a successful refresh).
   *
   * @param listener - called with the new token.
   * @returns the unsubscribe function.
   */
  onAccessTokenRefreshed(listener: AccessTokenRefreshedListener): () => void {
    this.refreshedListeners.add(listener);
    return () => {
      this.refreshedListeners.delete(listener);
    };
  }
}

export const api = new AppHttpClient({
  baseUrl: API_BASE_URL,
  // Named after the app so two apps on one origin never contend for a lock.
  refreshLockName: 'shellkeep-auth-refresh',
});

/**
 * The packaged `PlatformApiClient` over {@link api}, for the platform pages and
 * hooks. Built once, at module scope: packaged hooks key on its identity.
 */
export const platformApi = createPlatformApiClient(api);

// Storage API
export async function uploadFile(file: Blob, filename: string): Promise<{ id: string; status: string }> {
  const formData = new FormData();
  formData.append('file', file, filename);
  return api.postFormData<{ id: string; status: string }>('/storage/objects', formData);
}

export async function getDownloadUrl(objectId: string, expiresIn = 3600): Promise<string> {
  const result = await api.get<{ url: string; expiresIn: number }>(`/storage/objects/${objectId}/download?expiresIn=${expiresIn}`);
  return result.url;
}
