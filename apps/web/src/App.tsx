import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth, RequirePermission } from '@marinoscar/platform-web/identity/headless';
import { IdentityProviders } from './identity/IdentityProviders';
import { ThemeContextProvider, useThemeContext } from './contexts/ThemeContext';
import { Layout } from './components/common/Layout';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { PWAUpdatePrompt } from './components/PWAUpdatePrompt';
import { TerminalAccessGate } from './components/terminal/TerminalAccessGate';

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
const UserSettingsPage = lazy(() => import('./pages/UserSettingsPage'));

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
                <Route path="/settings" element={<UserSettingsPage />} />
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
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <ThemeContextProvider>
      <IdentityProviders>
        <AppRoutes />
        <PWAUpdatePrompt />
      </IdentityProviders>
    </ThemeContextProvider>
  );
}
