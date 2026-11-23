import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth, RequirePermission } from '@marinoscar/platform-web/identity/headless';
import { IdentityProviders } from './identity/IdentityProviders';
import { ThemeContextProvider, useThemeContext } from './contexts/ThemeContext';
import { Layout } from './components/common/Layout';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { InstallPrompt, MaintenanceGate, UpdatePrompt } from '@marinoscar/platform-web/host/ui';
import { APP_NAME } from './config/app';
import {
  ABOUT_PATH,
  ADMIN_HUB_PATH,
  ADMIN_HUB_PERMISSIONS,
  MAINTENANCE_PATH,
} from './config/adminSections';
import { TerminalAccessGate } from './components/terminal/TerminalAccessGate';
import { AppPlatformHostProvider } from './platform/platformHost';

// Pages (lazy loaded)
import { Suspense, lazy } from 'react';
import { LoadingSpinner } from './components/common/LoadingSpinner';

// The identity pages are the platform's (`@marinoscar/platform-web/identity/ui`,
// issue #47). Login is this app's thin binding that brands the packaged page.
const LoginPage = lazy(() => import('./identity/LoginPage'));
const AuthCallbackPage = lazy(() =>
  import('@marinoscar/platform-web/identity/ui').then((m) => ({ default: m.AuthCallbackPage })),
);
const ActivateDevicePage = lazy(() =>
  import('@marinoscar/platform-web/identity/ui').then((m) => ({ default: m.ActivateDevicePage })),
);
const UsersPage = lazy(() =>
  import('@marinoscar/platform-web/identity/ui').then((m) => ({ default: m.UsersPage })),
);
const HomePage = lazy(() => import('./pages/HomePage'));
const ServerProfilesPage = lazy(() => import('./pages/ServerProfilesPage'));
const SessionsPage = lazy(() => import('./pages/SessionsPage'));
const TerminalPage = lazy(() => import('./pages/TerminalPage'));
const TerminalFullPage = lazy(() => import('./pages/TerminalFullPage'));
// Settings (issue #48): the packaged hub over `config/userSettingsSections.tsx`,
// the packaged Profile and Appearance pages, and the terminal domain's page.
const UserSettingsHubPage = lazy(() => import('./pages/UserSettingsHubPage'));
const UserProfilePage = lazy(() =>
  import('@marinoscar/platform-web/settings/ui').then((m) => ({ default: m.UserProfilePage })),
);
const UserAppearancePage = lazy(() =>
  import('@marinoscar/platform-web/settings/ui').then((m) => ({ default: m.UserAppearancePage })),
);
const TerminalSettingsPage = lazy(
  () => import('./components/terminal/settings/TerminalSettingsPage'),
);
// Admin settings (issue #46): the packaged hub over `config/adminSections.tsx`,
// the host slice's About and Maintenance pages and the packaged Doctor.
const AdminSettingsHubPage = lazy(() => import('./pages/AdminSettingsHubPage'));
const AboutPage = lazy(() =>
  import('@marinoscar/platform-web/host/ui').then((m) => ({ default: m.AboutPage })),
);
const MaintenancePage = lazy(() =>
  import('@marinoscar/platform-web/host/ui').then((m) => ({ default: m.MaintenancePage })),
);
const DoctorPage = lazy(() =>
  import('@marinoscar/platform-web/doctor/ui').then((m) => ({
    default: m.doctorSettingsPage.Page,
  })),
);

// Test login page (development only). The platform's test login endpoint
// (`POST /api/auth/test/login`) has no packaged page; this form posts to it.
const TestLoginPage = import.meta.env.PROD
  ? null
  : lazy(() => import('./pages/TestLoginPage'));

/** Sends a viewer without the route's permission home. */
const HOME = <Navigate to="/" replace />;

function AppRoutes() {
  const { theme } = useThemeContext();

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        {/* The host slice's client gate (#46): while the API answers a request
            with a maintenance 503 (recorded by `services/api.ts`), the screen
            replaces the routes; every route but the Maintenance page. */}
        <MaintenanceGate appName={APP_NAME}>
          <Suspense fallback={<LoadingSpinner fullScreen />}>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              {/* A failed sign-in: the packaged page shows the screen for `?error=<code>`. */}
              <Route path="/auth/error" element={<AuthCallbackPage />} />

              {/* Test login (development only) */}
              {!import.meta.env.PROD && TestLoginPage && (
                <Route path="/testing/login" element={<TestLoginPage />} />
              )}

              {/* Protected routes */}
              <Route element={<RequireAuth loading={<LoadingSpinner fullScreen />} />}>
                {/* Device activation page - without layout for full-screen experience */}
                <Route path="/activate" element={<ActivateDevicePage />} />

                {/* Full-screen terminal - without layout */}
                <Route
                  path="/terminal/:id"
                  element={
                    <RequirePermission permission="sessions:read" fallback={HOME}>
                      <TerminalAccessGate>
                        <TerminalFullPage />
                      </TerminalAccessGate>
                    </RequirePermission>
                  }
                />

                <Route element={<Layout />}>
                  <Route path="/" element={<HomePage />} />
                  <Route
                    path="/sessions"
                    element={
                      <RequirePermission permission="sessions:read" fallback={HOME}>
                        <SessionsPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/sessions/:id/terminal"
                    element={
                      <RequirePermission permission="sessions:read" fallback={HOME}>
                        <TerminalAccessGate>
                          <TerminalPage />
                        </TerminalAccessGate>
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/servers"
                    element={
                      <RequirePermission permission="servers:read" fallback={HOME}>
                        <ServerProfilesPage />
                      </RequirePermission>
                    }
                  />
                  {/* Settings (#48): every card of USER_SETTINGS_SECTIONS has a route
                      here, and none is gated (user_settings:* is every role's). */}
                  <Route path="/settings" element={<UserSettingsHubPage />} />
                  <Route path="/settings/profile" element={<UserProfilePage />} />
                  <Route path="/settings/appearance" element={<UserAppearancePage />} />
                  <Route path="/settings/terminal" element={<TerminalSettingsPage />} />
                  {/* Admin settings (#46): every card of ADMIN_SECTIONS has a route
                      here, gated on the card's permission (the string its API
                      controller enforces). The hub admits any card's permission. */}
                  <Route
                    path={ADMIN_HUB_PATH}
                    element={
                      <RequirePermission permissions={ADMIN_HUB_PERMISSIONS} fallback={HOME}>
                        <AdminSettingsHubPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path={ABOUT_PATH}
                    element={
                      <RequirePermission permission="system_settings:read" fallback={HOME}>
                        <AboutPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path={MAINTENANCE_PATH}
                    element={
                      <RequirePermission permission="system_settings:read" fallback={HOME}>
                        <MaintenancePage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/admin/settings/users"
                    element={
                      <RequirePermission permission="users:read" fallback={HOME}>
                        <UsersPage />
                      </RequirePermission>
                    }
                  />
                  <Route
                    path="/admin/settings/doctor"
                    element={
                      <RequirePermission permission="system_settings:read" fallback={HOME}>
                        <DoctorPage />
                      </RequirePermission>
                    }
                  />
                  {/* `users:read` is what `GET /api/users` enforces; the packaged page
                      gates its Allowlist tab on `allowlist:read` itself. */}
                  <Route
                    path="/admin/users"
                    element={
                      <RequirePermission permission="users:read" fallback={HOME}>
                        <UsersPage />
                      </RequirePermission>
                    }
                  />
                </Route>
              </Route>

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </MaintenanceGate>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <ThemeContextProvider>
      <IdentityProviders>
        <AppPlatformHostProvider>
          <AppRoutes />
          {/* The host slice's PWA prompts (#46): the update prompt also
              registers the service worker. */}
          <UpdatePrompt useRegisterSW={useRegisterSW} />
          <InstallPrompt appName={APP_NAME} />
        </AppPlatformHostProvider>
      </IdentityProviders>
    </ThemeContextProvider>
  );
}
