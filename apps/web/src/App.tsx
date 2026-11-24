import type { ReactNode } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { RequireAuth, RequirePermission } from '@marinoscar/platform-web/identity/headless';
import { ShellProviders } from '@marinoscar/platform-web/shell/headless';
import type { ShellProvider } from '@marinoscar/platform-web/shell/headless';
import { ShellRoot } from '@marinoscar/platform-web/shell/ui';
import { IdentityProviders } from './identity/IdentityProviders';
import { SHELLKEEP_THEMES } from './platform/shellTheme';
import { Layout } from './components/common/Layout';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { InstallPrompt, MaintenanceGate, UpdatePrompt } from '@marinoscar/platform-web/host/ui';
import { APP_NAME } from './config/app';
import { TerminalAccessGate } from './components/terminal/TerminalAccessGate';
import { AppPlatformHostProvider } from './platform/platformHost';
import { JobsNodesProviders } from './platform/jobsAdapters';
// The notifications web slice (#51): its configuration first, for its side
// effect, before the first render.
import './platform/notifications';
import { NotificationProvider } from '@marinoscar/platform-web/notifications/headless';

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
// The session terminal at `/sessions/:id`, full-bleed inside the shell (#76);
// #77 replaces it with the session workspace.
const TerminalPage = lazy(() => import('./pages/TerminalPage'));
// Settings (issue #48): the packaged hub over `config/userSettingsSections.tsx`,
// the packaged Profile and Appearance pages, and the terminal domain's page.
const UserSettingsHubPage = lazy(() => import('./pages/UserSettingsHubPage'));
const UserProfilePage = lazy(() =>
  import('@marinoscar/platform-web/settings/ui').then((m) => ({ default: m.UserProfilePage })),
);
const UserAppearancePage = lazy(() =>
  import('@marinoscar/platform-web/settings/ui').then((m) => ({ default: m.UserAppearancePage })),
);
// The identity slice's per-user Access Tokens page (#47's card, routed by #76).
const UserTokensPage = lazy(() =>
  import('@marinoscar/platform-web/identity/ui').then((m) => ({ default: m.UserTokensPage })),
);
const TerminalSettingsPage = lazy(
  () => import('./components/terminal/settings/TerminalSettingsPage'),
);
// Admin settings (issue #46): the packaged hub over `config/adminSections.tsx`,
// the host slice's About and Maintenance pages, the packaged Doctor, and the
// terminal domain's system settings page.
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
const TerminalSystemSettingsPage = lazy(
  () => import('./components/terminal/settings/TerminalSystemSettingsPage'),
);
// Operations (issue #49): the packaged jobs and nodes pages.
const JobsPage = lazy(() =>
  import('@marinoscar/platform-web/jobs/ui').then((m) => ({ default: m.JobsPage })),
);
const JobInsightsPage = lazy(() =>
  import('@marinoscar/platform-web/jobs/ui').then((m) => ({ default: m.JobInsightsPage })),
);
const WorkersPage = lazy(() =>
  import('@marinoscar/platform-web/nodes/ui').then((m) => ({ default: m.WorkersPage })),
);

// Storage (issue #50): the packaged object-storage configuration page.
const StorageConfigPage = lazy(() => import('@marinoscar/platform-web/storage/ui'));

// Notifications (issue #51): the packaged email, Web Push and broadcasts
// pages, and the user's notification preferences.
const EmailSettingsPage = lazy(() => import('@marinoscar/platform-web/email/ui'));
const PushConfigPage = lazy(() =>
  import('@marinoscar/platform-web/notifications/ui').then((m) => ({ default: m.PushConfigPage })),
);
const BroadcastsPage = lazy(() =>
  import('@marinoscar/platform-web/notifications/ui').then((m) => ({ default: m.BroadcastsPage })),
);
// Database backup and restore (issue #52): the packaged admin page.
const DbBackupPage = lazy(() => import('@marinoscar/platform-web/db-backup/ui'));
// Webhooks and alerts (issue #54): the packaged pages. One webhooks page, routed once per scope.
const WebhooksPage = lazy(() =>
  import('@marinoscar/platform-web/webhooks/ui').then((m) => ({ default: m.WebhooksPage })),
);
const AlertsPage = lazy(() =>
  import('@marinoscar/platform-web/alerts/ui').then((m) => ({ default: m.AlertsPage })),
);
const UserNotificationsPage = lazy(() =>
  import('@marinoscar/platform-web/notifications/ui').then((m) => ({
    default: m.UserNotificationsPage,
  })),
);

// Test login page (development only). The platform's test login endpoint
// (`POST /api/auth/test/login`) has no packaged page; this form posts to it.
const TestLoginPage = import.meta.env.PROD
  ? null
  : lazy(() => import('./pages/TestLoginPage'));


/** Sends a viewer without the route's permission home. */
const HOME = <Navigate to="/" replace />;

/**
 * The old terminal URLs (`/terminal/:id`, the layout-less page, and
 * `/sessions/:id/terminal`) now land on the session itself, `/sessions/:id`
 * (#76), so a bookmark or an "open in new tab" link keeps working.
 */
function SessionRedirect() {
  const { id = '' } = useParams<{ id: string }>();
  return <Navigate to={`/sessions/${encodeURIComponent(id)}`} replace />;
}

/** The slices' adapters for the packaged jobs and nodes pages (#49). */
function JobsNodesShellProvider({ children }: { children: ReactNode }) {
  return <JobsNodesProviders>{children}</JobsNodesProviders>;
}

/**
 * The providers around the signed-in shell, outermost first (`ShellProviders`,
 * #76). Inside `RequireAuth`: the notification centre (#51) wraps the SHELL
 * because the bell lives in its AppBar and one mount means one live stream
 * per tab; the jobs and nodes adapters serve the Console's Operations pages.
 */
const SHELL_PROVIDERS: readonly ShellProvider[] = [NotificationProvider, JobsNodesShellProvider];

function AppRoutes() {
  return (
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
              {/* Device activation page - without the shell for a full-screen experience */}
              <Route path="/activate" element={<ActivateDevicePage />} />

              {/* The signed-in shell (#76): the platform's ShellLayout, bound in
                  `components/common/Layout.tsx`, around every page below. */}
              <Route
                element={
                  <ShellProviders providers={SHELL_PROVIDERS}>
                    <Layout />
                  </ShellProviders>
                }
              >
                <Route path="/" element={<HomePage />} />
                <Route
                  path="/sessions"
                  element={
                    <RequirePermission permission="sessions:read" fallback={HOME}>
                      <SessionsPage />
                    </RequirePermission>
                  }
                />
                {/* The session terminal, full-bleed (`useShellMainVariant`). */}
                <Route
                  path="/sessions/:id"
                  element={
                    <RequirePermission permission="sessions:read" fallback={HOME}>
                      <TerminalAccessGate>
                        <TerminalPage />
                      </TerminalAccessGate>
                    </RequirePermission>
                  }
                />
                <Route path="/sessions/:id/terminal" element={<SessionRedirect />} />
                <Route path="/terminal/:id" element={<SessionRedirect />} />
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
                <Route path="/settings/notifications" element={<UserNotificationsPage />} />
                <Route path="/settings/tokens" element={<UserTokensPage />} />
                {/* Webhooks (#54): the caller's own endpoints, gated on the string
                    `/api/webhooks` enforces. Writes are gated inside the page. */}
                <Route
                  path="/settings/webhooks"
                  element={
                    <RequirePermission permission="webhooks:read" fallback={HOME}>
                      <WebhooksPage scope="user" />
                    </RequirePermission>
                  }
                />
                {/* The Console (#46, #76): every card of ADMIN_SECTIONS has a route
                    here, gated on the card's permission (the string its API
                    controller enforces). The hub admits any card's permission
                    (`ADMIN_HUB_PERMISSIONS`). Paths are spelled out: the
                    registry tests and the web conformance suites parse this
                    file as text. */}
                <Route path="/admin" element={<Navigate to="/admin/settings" replace />} />
                <Route
                  path="/admin/settings"
                  element={
                    <RequirePermission permissions={['system_settings:read', 'users:read', 'jobs:read', 'nodes:read', 'storage_config:read', 'push:read', 'broadcasts:read', 'org_broadcasts:read', 'db_backup:read', 'alerts:read', 'system_webhooks:read', 'org_webhooks:read']} fallback={HOME}>
                      <AdminSettingsHubPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/admin/settings/about"
                  element={
                    <RequirePermission permission="system_settings:read" fallback={HOME}>
                      <AboutPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/admin/settings/maintenance"
                  element={
                    <RequirePermission permission="system_settings:read" fallback={HOME}>
                      <MaintenancePage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/admin/settings/terminal"
                  element={
                    <RequirePermission permission="system_settings:read" fallback={HOME}>
                      <TerminalSystemSettingsPage />
                    </RequirePermission>
                  }
                />
                {/* Storage (#50): `storage_config:read` is what the storage
                    slice's `/api/admin/storage-config` GET enforces (not
                    `storage:read`, which every role holds). Saving, testing
                    and migrating need `storage_config:write`, gated inside
                    the packaged page. */}
                <Route
                  path="/admin/settings/storage"
                  element={
                    <RequirePermission permission="storage_config:read" fallback={HOME}>
                      <StorageConfigPage />
                    </RequirePermission>
                  }
                />
                {/* Email (#51): `GET /api/email-settings` enforces
                    `system_settings:read`; saving and the test send need
                    `system_settings:write`, gated inside the page. */}
                <Route
                  path="/admin/settings/email"
                  element={
                    <RequirePermission permission="system_settings:read" fallback={HOME}>
                      <EmailSettingsPage />
                    </RequirePermission>
                  }
                />
                {/* Web Push (#51): `GET /api/admin/push-config` enforces
                    `push:read`; key generation, rotation and the test push
                    need `push:write`, gated inside the page. */}
                <Route
                  path="/admin/settings/push"
                  element={
                    <RequirePermission permission="push:read" fallback={HOME}>
                      <PushConfigPage />
                    </RequirePermission>
                  }
                />
                {/* Broadcasts (#51): the controller admits either scope
                    (`anyPermissions`); writes need the matching `:write`,
                    gated inside the page. */}
                <Route
                  path="/admin/settings/broadcasts"
                  element={
                    <RequirePermission permissions={['broadcasts:read', 'org_broadcasts:read']} fallback={HOME}>
                      <BroadcastsPage />
                    </RequirePermission>
                  }
                />
                {/* Database backup (#52): reads need `db_backup:read`; writes and
                    restore are gated inside the packaged page. */}
                <Route
                  path="/admin/settings/db-backup"
                  element={
                    <RequirePermission permission="db_backup:read" fallback={HOME}>
                      <DbBackupPage />
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
                {/* Alerts (#54): `alerts:read`, the string every read route of
                    `/api/admin/alerts` enforces; writes (`alerts:write`) are gated
                    inside the page. Not behind a telemetry gate: node rules work
                    while telemetry is off. */}
                <Route
                  path="/admin/settings/alerts"
                  element={
                    <RequirePermission permission="alerts:read" fallback={HOME}>
                      <AlertsPage />
                    </RequirePermission>
                  }
                />
                {/* Webhooks (#54): the deployment's endpoints (`system_webhooks:read`,
                    `/api/admin/webhooks`) and the organization's (`org_webhooks:read`,
                    `/api/org/webhooks`, `org_admin` only). Writes
                    are gated inside the page. */}
                <Route
                  path="/admin/settings/webhooks"
                  element={
                    <RequirePermission permission="system_webhooks:read" fallback={HOME}>
                      <WebhooksPage scope="system" />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/admin/settings/organization-webhooks"
                  element={
                    <RequirePermission permission="org_webhooks:read" fallback={HOME}>
                      <WebhooksPage scope="org" />
                    </RequirePermission>
                  }
                />
                {/* Operations (#49). `jobs:read` is what the jobs slice's
                    admin controller enforces on the list, the stats and the
                    insights; `nodes:read` is the nodes admin controller's.
                    Writes (`jobs:write`, `nodes:write`) are gated inside the
                    pages. Job Insights nests under the Jobs path: two routes,
                    not a tab. */}
                <Route
                  path="/admin/settings/jobs"
                  element={
                    <RequirePermission permission="jobs:read" fallback={HOME}>
                      <JobsPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/admin/settings/jobs/insights"
                  element={
                    <RequirePermission permission="jobs:read" fallback={HOME}>
                      <JobInsightsPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/admin/settings/workers"
                  element={
                    <RequirePermission permission="nodes:read" fallback={HOME}>
                      <WorkersPage />
                    </RequirePermission>
                  }
                />
                {/* `users:read` is what `GET /api/users` enforces; the packaged page
                    gates its Allowlist tab on `allowlist:read` itself. Kept for
                    bookmarks; the Console card is `/admin/settings/users`. */}
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
  );
}

export default function App() {
  return (
    // The shell's theme root (#76): the viewer's light, dark or system choice
    // (kept under `localStorage['theme_mode']`), MUI's ThemeProvider and
    // CssBaseline for the resolved ShellKeep theme.
    <ShellRoot themes={SHELLKEEP_THEMES}>
      <IdentityProviders>
        <AppPlatformHostProvider>
          <AppRoutes />
          {/* The host slice's PWA prompts (#46): the update prompt also
              registers the service worker. */}
          <UpdatePrompt useRegisterSW={useRegisterSW} />
          <InstallPrompt appName={APP_NAME} />
        </AppPlatformHostProvider>
      </IdentityProviders>
    </ShellRoot>
  );
}
