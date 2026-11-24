import type { ReactNode } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { RequireAuth, RequirePermission } from '@marinoscar/platform-web/identity/headless';
import { AiConfigProvider, AiWebAdaptersProvider } from '@marinoscar/platform-web/ai/headless';
import { RequireAiEnabled } from '@marinoscar/platform-web/ai/ui/require-ai-enabled';
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
import { appAiAdapters } from './platform/aiAdapters';
import { platformApi } from './services/api';
// The deployment feature map (#55): registers `ai` for the cards and the
// destination that carry `feature: 'ai'`. Imported for its side effect.
import './platform/settingsFeatures';
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
// The session workspace at `/sessions/:id` (#77): tabs, splits and the
// switcher, full-bleed inside the shell (#76).
const TerminalWorkspacePage = lazy(() => import('./pages/TerminalWorkspacePage'));
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
// #80: the key bar's shortcuts, their own card next to Terminal.
const ShortcutsSettingsPage = lazy(
  () => import('./components/terminal/settings/ShortcutsSettingsPage'),
);
// Sharing (#71): the packaged groups pages behind the Groups card of the user hub.
const GroupsPage = lazy(() =>
  import('@marinoscar/platform-web/sharing/ui').then((m) => ({ default: m.GroupsPage })),
);
const GroupDetailPage = lazy(() =>
  import('@marinoscar/platform-web/sharing/ui').then((m) => ({ default: m.GroupDetailPage })),
);
// Data export (#68): the packaged "Download your data" page behind the card of the user hub.
const DataExportPage = lazy(() =>
  import('@marinoscar/platform-web/exports/ui').then((m) => ({ default: m.DataExportPage })),
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
// AI (issue #55): the packaged admin, user and Playground pages.
const AiConfigPage = lazy(() => import('@marinoscar/platform-web/ai/ui/config-page'));
const AiModelsPage = lazy(() => import('@marinoscar/platform-web/ai/ui/models-page'));
const AiUsagePage = lazy(() => import('@marinoscar/platform-web/ai/ui/usage-page'));
const OrgAiKeysPage = lazy(() => import('@marinoscar/platform-web/ai/ui'));
const UserAiKeysPage = lazy(() => import('@marinoscar/platform-web/ai/ui/keys-page'));
const AiPlaygroundPage = lazy(() => import('@marinoscar/platform-web/ai/ui/playground-page'));
// Database backup and restore (issue #52): the packaged admin page.
const DbBackupPage = lazy(() => import('@marinoscar/platform-web/db-backup/ui'));
// Webhooks and alerts (issue #54): the packaged pages. One webhooks page, routed once per scope.
const WebhooksPage = lazy(() =>
  import('@marinoscar/platform-web/webhooks/ui').then((m) => ({ default: m.WebhooksPage })),
);
const AlertsPage = lazy(() =>
  import('@marinoscar/platform-web/alerts/ui').then((m) => ({ default: m.AlertsPage })),
);
// User data deletion (issue #69): the packaged user Danger Zone and the admin factory reset. They re-read the
// signed-in user themselves through the host's `viewer.refresh` (`platform/platformHost.tsx`).
const DangerZonePage = lazy(() =>
  import('@marinoscar/platform-web/user-data/ui').then((m) => ({ default: m.UserDangerZonePage })),
);
const FactoryResetPage = lazy(() =>
  import('@marinoscar/platform-web/user-data/ui').then((m) => ({ default: m.FactoryResetPage })),
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
 * `GET /api/ai/config` once for the whole shell (#55): the kill switch the
 * `feature: 'ai'` cards, the Playground destination and `RequireAiEnabled`
 * all read.
 */
function AiConfigShellProvider({ children }: { children: ReactNode }) {
  return <AiConfigProvider api={platformApi}>{children}</AiConfigProvider>;
}

/** The app's spinner for the packaged AI pages (#55). */
function AiAdaptersShellProvider({ children }: { children: ReactNode }) {
  return <AiWebAdaptersProvider adapters={appAiAdapters}>{children}</AiWebAdaptersProvider>;
}

/**
 * The providers around the signed-in shell, outermost first (`ShellProviders`,
 * #76). Inside `RequireAuth`: the notification centre (#51) wraps the SHELL
 * because the bell lives in its AppBar and one mount means one live stream
 * per tab; the jobs and nodes adapters serve the Console's Operations pages.
 */
const SHELL_PROVIDERS: readonly ShellProvider[] = [
  NotificationProvider,
  AiConfigShellProvider,
  AiAdaptersShellProvider,
  JobsNodesShellProvider,
];

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
                        <TerminalWorkspacePage />
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
                <Route path="/settings/shortcuts" element={<ShortcutsSettingsPage />} />
                <Route path="/settings/notifications" element={<UserNotificationsPage />} />
                <Route path="/settings/tokens" element={<UserTokensPage />} />
                {/* AI keys (#55): `ai:use` is what the `/api/ai/keys` controller
                    enforces, a grant a deployment can withhold from a role (it is
                    seeded to org_admin and contributor, not viewer). Behind
                    `RequireAiEnabled`: every call the page makes is refused while
                    AI is off. */}
                <Route
                  path="/settings/ai"
                  element={
                    <RequirePermission permission="ai:use" fallback={HOME}>
                      <RequireAiEnabled>
                        <UserAiKeysPage />
                      </RequireAiEnabled>
                    </RequirePermission>
                  }
                />
                {/* The Playground destination (#55): `ai:use` and AI on, the
                    gates of the `ai` destination in `config/destinations.ts`. */}
                <Route
                  path="/ai"
                  element={
                    <RequirePermission permission="ai:use" fallback={HOME}>
                      <RequireAiEnabled>
                        <AiPlaygroundPage />
                      </RequireAiEnabled>
                    </RequirePermission>
                  }
                />
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
                {/* Data export (#68): every role may export its own data; the page lists only the sources the
                    API returns for the caller. */}
                <Route path="/settings/data-export" element={<DataExportPage />} />
                {/* Issue #69. The user Danger Zone: ungated like its `/settings/*` siblings (the routes
                    require `user_settings:write`, which every role holds) and with no feature gate, so it
                    stays reachable while AI is off: the deletion also removes AI keys and runs. */}
                <Route path="/settings/danger-zone" element={<DangerZonePage />} />
                {/* Groups (#71): the sharing slice's pages, gated on the string `/api/groups`
                    enforces. The detail page is a child of the Groups card, not a card. */}
                <Route
                  path="/settings/groups"
                  element={
                    <RequirePermission permission="groups:read" fallback={HOME}>
                      <GroupsPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/settings/groups/:id"
                  element={
                    <RequirePermission permission="groups:read" fallback={HOME}>
                      <GroupDetailPage />
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
                    <RequirePermission permissions={['system_settings:read', 'users:read', 'jobs:read', 'nodes:read', 'storage_config:read', 'push:read', 'broadcasts:read', 'org_broadcasts:read', 'db_backup:read', 'alerts:read', 'system_webhooks:read', 'org_webhooks:read', 'ai_config:read', 'org_ai_config:read', 'system:factory_reset']} fallback={HOME}>
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
                {/* AI (#55). `ai_config:read` is what the admin AI controllers
                    enforce on their reads; saving, storing a key and editing a
                    model need `ai_config:write`, gated inside the pages.
                    `/admin/settings/ai` is deliberately NOT behind
                    `RequireAiEnabled`: it is where AI is switched on. The
                    others are, matching their cards' `feature: 'ai'`. */}
                <Route
                  path="/admin/settings/ai"
                  element={
                    <RequirePermission permission="ai_config:read" fallback={HOME}>
                      <AiConfigPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/admin/settings/ai/models"
                  element={
                    <RequirePermission permission="ai_config:read" fallback={HOME}>
                      <RequireAiEnabled>
                        <AiModelsPage />
                      </RequireAiEnabled>
                    </RequirePermission>
                  }
                />
                <Route
                  path="/admin/settings/ai/usage"
                  element={
                    <RequirePermission permission="ai_config:read" fallback={HOME}>
                      <RequireAiEnabled>
                        <AiUsagePage />
                      </RequireAiEnabled>
                    </RequirePermission>
                  }
                />
                {/* `org_ai_config:read` is the ORG permission the AI slice's
                    `org-keys.controller.ts` enforces on `GET /api/admin/ai/org-keys`;
                    writes are gated inside the page. */}
                <Route
                  path="/admin/settings/ai/organization-keys"
                  element={
                    <RequirePermission permission="org_ai_config:read" fallback={HOME}>
                      <RequireAiEnabled>
                        <OrgAiKeysPage />
                      </RequireAiEnabled>
                    </RequirePermission>
                  }
                />
                {/* Issue #69. The factory reset: `system:factory_reset`, the exact SYSTEM permission the
                    user-data slice's factory reset controller enforces (Admin only; never implied by
                    `system_settings:write`). */}
                <Route
                  path="/admin/settings/factory-reset"
                  element={
                    <RequirePermission permission="system:factory_reset" fallback={HOME}>
                      <FactoryResetPage />
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
