/**
 * This app's binding of the platform host (issue #48).
 *
 * The packaged settings pages (`UserProfilePage`, `UserAppearancePage`, the
 * `SettingsHub`) take their transport, the viewer and the theme setter from
 * ONE `PlatformHostProvider` (`@marinoscar/platform-web/core`):
 *
 *   - `api`: `hostApi`, the app's `platformApi` (`services/api.ts`) with the
 *     storage shim below. A module constant: packaged hooks key on its identity.
 *   - `viewer`: the signed-in user from the identity slice; `hasPermission` is
 *     `usePermissions`'s, the predicate every route guard uses.
 *   - `applyTheme`: the app theme context's `setMode`, so a theme picked on the
 *     Appearance page applies at once (light, dark and system; ShellKeep
 *     registers no other theme). The shell theme replaces it in #76.
 *
 * Mount `AppPlatformHostProvider` once, inside the identity providers and the
 * theme context.
 */

import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import type {
  PlatformApiClient,
  PlatformViewer,
  PlatformWebHost,
} from '@marinoscar/platform-web/core';
import { useAuth, usePermissions } from '@marinoscar/platform-web/identity/headless';
import { useSettingsFeatures } from '@marinoscar/platform-web/settings/headless';
import { useThemeContext } from '../contexts/ThemeContext';
import { platformApi } from '../services/api';

/** The storage-status route the packaged profile page reads. */
export const STORAGE_STATUS_PATH = '/storage/status';

/**
 * PLATFORM-ADOPTION-SHIM(#50): ShellKeep has no platform storage slice yet, so
 * `GET /api/storage/status` does not exist and the API refuses a profile with
 * `imageSource: 'upload'` (no avatar object can exist). The packaged profile
 * page swaps its upload control for a "storage is not configured" notice only
 * on an explicit `configured: false`, so the host answers that route with it.
 * Every other call goes to the app's client unchanged. #50 deletes this.
 */
export const hostApi: PlatformApiClient = {
  ...platformApi,
  get: <T,>(path: string, options?: Parameters<PlatformApiClient['get']>[1]): Promise<T> =>
    path === STORAGE_STATUS_PATH
      ? Promise.resolve({ configured: false } as T)
      : platformApi.get<T>(path, options),
};

const THEME_MODES = ['light', 'dark', 'system'] as const;
type ThemeMode = (typeof THEME_MODES)[number];

function isThemeMode(theme: string): theme is ThemeMode {
  return (THEME_MODES as readonly string[]).includes(theme);
}

/** This app's {@link PlatformWebHost}, memoised. */
export function useAppPlatformHost(): PlatformWebHost {
  const { user, refreshUser } = useAuth();
  const { hasPermission } = usePermissions();
  const { setMode } = useThemeContext();
  const features = useSettingsFeatures();

  const applyTheme = useCallback<NonNullable<PlatformWebHost['applyTheme']>>(
    (theme) => {
      // An id this app has no theme for is ignored, as the host contract asks.
      if (isThemeMode(theme)) setMode(theme);
    },
    [setMode],
  );

  const userId = user?.id ?? null;
  const email = user?.email ?? null;

  const viewer = useMemo<PlatformViewer>(
    () => ({
      userId,
      email,
      hasPermission,
      isFeatureEnabled: (feature) => features[feature as keyof typeof features] === true,
      refresh: refreshUser,
    }),
    [userId, email, hasPermission, features, refreshUser],
  );

  return useMemo<PlatformWebHost>(() => ({ api: hostApi, viewer, applyTheme }), [viewer, applyTheme]);
}

/** Mounts the packaged `PlatformHostProvider` with {@link useAppPlatformHost}. */
export function AppPlatformHostProvider({ children }: { children: ReactNode }) {
  const host = useAppPlatformHost();
  return <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}
