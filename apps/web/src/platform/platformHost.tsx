/**
 * This app's binding of the platform host (issue #48).
 *
 * The packaged settings pages (`UserProfilePage`, `UserAppearancePage`, the
 * `SettingsHub`) take their transport, the viewer and the theme setter from
 * ONE `PlatformHostProvider` (`@marinoscar/platform-web/core`):
 *
 *   - `api`: the app's `platformApi` (`services/api.ts`), unchanged. A module
 *     constant: packaged hooks key on its identity. Since #50 the API serves
 *     `GET /api/storage/status` and the profile-image upload itself, so the
 *     packaged profile page shows its upload control once storage is configured.
 *   - `viewer`: the signed-in user from the identity slice; `hasPermission` is
 *     `usePermissions`'s, the predicate every route guard uses.
 *   - `applyTheme`: the shell theme's `setMode` (`ShellRoot`, #76), so a theme
 *     picked on the Appearance page applies at once (light, dark and system;
 *     ShellKeep registers no other theme).
 *
 * Mount `AppPlatformHostProvider` once, inside the identity providers and
 * `ShellRoot`.
 */

import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import type { PlatformViewer, PlatformWebHost } from '@marinoscar/platform-web/core';
import { useAuth, usePermissions } from '@marinoscar/platform-web/identity/headless';
import { useSettingsFeatures } from '@marinoscar/platform-web/settings/headless';
import { useShellTheme } from '@marinoscar/platform-web/shell/headless';
import { platformApi } from '../services/api';

const THEME_MODES = ['light', 'dark', 'system'] as const;
type ThemeMode = (typeof THEME_MODES)[number];

function isThemeMode(theme: string): theme is ThemeMode {
  return (THEME_MODES as readonly string[]).includes(theme);
}

/** This app's {@link PlatformWebHost}, memoised. */
export function useAppPlatformHost(): PlatformWebHost {
  const { user, refreshUser } = useAuth();
  const { hasPermission } = usePermissions();
  const { setMode } = useShellTheme();
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

  return useMemo<PlatformWebHost>(() => ({ api: platformApi, viewer, applyTheme }), [viewer, applyTheme]);
}

/** Mounts the packaged `PlatformHostProvider` with {@link useAppPlatformHost}. */
export function AppPlatformHostProvider({ children }: { children: ReactNode }) {
  const host = useAppPlatformHost();
  return <PlatformHostProvider host={host}>{children}</PlatformHostProvider>;
}
