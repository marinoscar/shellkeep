/**
 * Visual regression harness (issue #81), not part of the shipped app.
 *
 * It mounts the app's REAL route tree (`AppRoutes` of `src/App.tsx`: the real
 * `Layout`, the destinations, the settings hubs and every page) behind a fake,
 * synchronous auth context, so Playwright can screenshot the actual pixel
 * layout, which jsdom cannot (no layout engine, no font metrics, no viewport).
 * Nothing here reimplements app behaviour; this file supplies only the wiring
 * `App()` normally gets from the network:
 *
 *   - a fake `AuthContext` (no `/api/auth/*`), whose user's permissions and
 *     roles come from the URL;
 *   - a `MemoryRouter` at the URL's `route`;
 *   - the light/dark choice, written where `ShellRoot` reads it;
 *   - a fake terminal WebSocket (`fakeTerminalWs.ts`);
 *   - an access token, because the terminal refuses to open without one.
 *
 * Every OTHER `/api` call the pages make (the session list, the dashboard, the
 * user settings, ...) is answered by the spec through Playwright's
 * `page.route()` with JSON from `tests/visual/support/fixtures`. This page
 * serves no API: nothing is proxied and nothing listens.
 *
 * QUERY PARAMS (read once, before the first render):
 *
 *   ?route=/servers          Initial router entry, query string included
 *                            (`/sessions/a?tabs=a,b&split=v:a|b`). Default `/`.
 *   ?perms=a,b,c             `user.permissions`. Default: EVERY permission the
 *                            API has (`api-permissions.json`), so every
 *                            destination and card is visible unless a spec
 *                            narrows it. `?perms=` (empty) means none.
 *   ?roles=admin             `user.roles` names. Default `admin`.
 *   ?theme=light|dark        Written to `localStorage.theme_mode` before the
 *                            first render, the key `ShellRoot` reads. Default
 *                            `dark`.
 *   ?fixture=<name>          Which fixture set the spec installed; recorded on
 *                            `<html data-fixture>` so a failing screenshot says
 *                            which state it was.
 *
 * The clock, the time zone and the locale are pinned by the Playwright project
 * (`tests/visual/playwright.config.ts` and `support/harness.ts`), not here.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import {
  AuthContext,
  IdentityWebAdaptersProvider,
} from '@marinoscar/platform-web/identity/headless';
import type { AuthContextValue, AuthUser } from '@marinoscar/platform-web/identity/headless';
import { ShellRoot } from '@marinoscar/platform-web/shell/ui';
import { AppRoutes } from '../src/App';
import { SHELLKEEP_THEMES } from '../src/platform/shellTheme';
import { AppPlatformHostProvider } from '../src/platform/platformHost';
import { appIdentityAdapters } from '../src/identity/identityAdapters';
import { api } from '../src/services/api';
import apiPermissions from '../src/__tests__/fixtures/api-permissions.json';
import { installFakeTerminalWs } from './fakeTerminalWs';

/** The key `ShellRoot` keeps the viewer's light, dark or system choice under. */
const THEME_STORAGE_KEY = 'theme_mode';

const search = new URLSearchParams(window.location.search);

const route = search.get('route') || '/';
const theme = search.get('theme') === 'light' ? 'light' : 'dark';
const permsParam = search.get('perms');
const permissions =
  permsParam === null
    ? [...apiPermissions.permissions]
    : permsParam
        .split(',')
        .map((permission) => permission.trim())
        .filter(Boolean);
const roles = (search.get('roles') || 'admin')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)
  .map((name) => ({ name }));

document.documentElement.dataset.fixture = search.get('fixture') ?? '';
try {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
} catch {
  // A browser with storage blocked renders the default theme; the spec asserts the theme.
}

installFakeTerminalWs();
// The terminal refuses to open without a token; the fake gateway accepts any.
api.setAccessToken('visual-harness-token');

// No profile image: a real URL is a network fetch the harness must not make,
// and initials are fully deterministic.
const harnessUser: AuthUser = {
  id: 'visual-user',
  email: 'person-a@example.test',
  displayName: 'Person A',
  profileImageUrl: null,
  roles,
  permissions,
  isActive: true,
  createdAt: '2025-01-01T00:00:00.000Z',
};

const fakeAuth: AuthContextValue = {
  user: harnessUser,
  isLoading: false,
  isAuthenticated: true,
  providers: [],
  sessionExpired: false,
  login: () => {},
  logout: async () => {},
  refreshUser: async () => {},
  setAccessToken: () => {},
  activeOrg: null,
  memberships: [],
  switchOrg: async () => {},
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MemoryRouter initialEntries={[route]}>
      {/* The same nesting as `App()`: theme root, identity, host, routes. */}
      <ShellRoot themes={SHELLKEEP_THEMES}>
        <AuthContext.Provider value={fakeAuth}>
          <IdentityWebAdaptersProvider adapters={appIdentityAdapters}>
            <AppPlatformHostProvider>
              <AppRoutes />
            </AppPlatformHostProvider>
          </IdentityWebAdaptersProvider>
        </AuthContext.Provider>
      </ShellRoot>
    </MemoryRouter>
  </StrictMode>,
);
