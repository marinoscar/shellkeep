/**
 * The destination model: canonical keys, route ownership and active state
 * (issue #76). The SINGLE source of truth for where the app can go. The rail,
 * the bottom bar and the user menu of the platform shell
 * (`@marinoscar/platform-web/shell`) all read this table through
 * `config/shell.ts`, so they show the same destinations behind the same gates.
 *
 * Two rules keep the ownership table honest:
 *
 *  1. A route is owned by at most one destination. `destinations.test.ts`
 *     checks every `<Route path>` of `App.tsx` against this file, so a route
 *     added without an owner (or an `UNOWNED_ROUTES` entry) fails the build.
 *  2. Matching respects segment boundaries (`owns`): `/sessions` owns
 *     `/sessions/abc`, never `/sessionsfoo`; `/` owns only itself.
 *
 * `Icon` is a COMPONENT, never a rendered element: the rail draws it `small`
 * collapsed and `medium` expanded, and the bottom bar at its own size.
 *
 * Gating is by permission, never by role, and each string is the one the API
 * controller enforces (checked against the API permission catalog by the web
 * conformance suite, `__tests__/conformance.test.ts`):
 *
 *   - Sessions: `sessions:read` (`terminal/sessions` controller, `GET /api/sessions`).
 *   - Servers: `servers:read` (`server-profiles` controller, `GET /api/server-profiles`).
 *   - Console: ANY OF `system_settings:read` and `users:read`. `/admin/settings`
 *     fronts pages from several controllers; a viewer entitled to one of them
 *     still reaches the hub, and the per-card gates decide what it shows.
 */

import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import TerminalIcon from '@mui/icons-material/Terminal';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import {
  isDestinationVisible,
  owns,
  resolveActiveDestination as resolveShellDestination,
} from '@marinoscar/platform-web/shell/headless';
import type { ShellDestination } from '@marinoscar/platform-web/shell/headless';
import { USER_HUB_PATH } from './userSettingsSections';
import { SessionSwitcherPane } from '../components/terminal/workspace/SessionSwitcherPane';

/**
 * Every destination key. `runbooks` and `runs` are reserved for #65 (they need
 * the runbooks API of #61, not merged yet); no destination declares them today.
 */
export type DestinationKey = 'home' | 'sessions' | 'servers' | 'runbooks' | 'runs' | 'console' | 'ai';

/** A navigation destination: the shell's `ShellDestination` over this app's keys. */
export type Destination = ShellDestination<DestinationKey>;

/** Segment-boundary prefix matching: the shell's own function, re-exported. */
export { owns };

/** Whether a viewer may see a destination: the shell's one gate, re-exported. */
export { isDestinationVisible };

/**
 * The route prefixes each destination OWNS (lights up on). Child routes are
 * covered by their parent prefix (`/sessions/:id`, `/admin/settings/users`).
 *
 * `console` owns the bare `/admin`, not just `/admin/settings` where it
 * navigates: `/admin` and `/admin/users` are routes too, and the shell's
 * Console mode turns on for the same prefix (`config/shell.ts`).
 *
 * `home` also owns the per-user settings (`/settings` and its pages). Settings
 * is not a destination of its own (the rail and the phone bar are kept for the
 * work surfaces; the user menu reaches it), but every settings card must sit
 * inside the destination that owns its hub (the `settings-card-routes`
 * conformance suite), and the viewer's own corner belongs with Home.
 *
 * `runbooks` and `runs` own nothing until #65 routes them.
 */
export const DESTINATION_ROUTES: Readonly<Record<DestinationKey, readonly string[]>> = {
  home: ['/', USER_HUB_PATH],
  sessions: ['/sessions', '/terminal'],
  servers: ['/servers'],
  runbooks: [],
  runs: [],
  console: ['/admin'],
  // The AI Playground (#55) owns `/ai` only: the user's AI Keys page lives at
  // `/settings/ai` (Home) and the admin AI pages at `/admin/settings/ai` (Console).
  ai: ['/ai'],
};

/**
 * Routes deliberately owned by NO destination: reached from outside the
 * signed-in shell (the sign-in flow, the OAuth round trip, the failed sign-in
 * screen, device activation and the development test login). On these no
 * destination is active, and that is correct rather than a bug.
 */
export const UNOWNED_ROUTES: readonly string[] = [
  '/login',
  '/auth/callback',
  '/auth/error',
  '/activate',
  '/testing/login',
];

/**
 * The destinations, in navigation order (declaration order is the order on
 * every surface; the rail lifts the pinned Console to its foot).
 */
export const DESTINATIONS: readonly Destination[] = [
  {
    key: 'home',
    label: 'Home',
    compactLabel: 'Home',
    Icon: HomeOutlinedIcon,
    path: '/',
  },
  {
    key: 'sessions',
    label: 'Sessions',
    compactLabel: 'Sessions',
    Icon: TerminalIcon,
    path: '/sessions',
    permission: 'sessions:read',
    // The session switcher beside the EXPANDED rail (#77); below it the
    // workspace toolbar shows the same list as a menu.
    contextPane: SessionSwitcherPane,
  },
  {
    key: 'servers',
    label: 'Servers',
    compactLabel: 'Servers',
    Icon: DnsOutlinedIcon,
    path: '/servers',
    permission: 'servers:read',
  },
  // #65 APPENDS `runbooks` (Runbooks, `/runbooks`, `runbooks:read`) and `runs`
  // (Runs, `/runs`, `runbooks:read`) HERE, before `console`, once #61 ships the
  // runbooks API and its permissions. With six destinations the phone bar shows
  // Home, Sessions, Servers and More, and More holds Runbooks, Runs and Console.
  {
    key: 'console',
    label: 'Console',
    compactLabel: 'Console',
    Icon: AdminPanelSettingsOutlinedIcon,
    path: '/admin/settings',
    anyPermission: ['system_settings:read', 'users:read'],
    // A mode at the rail's foot, not a peer of the library destinations.
    pinned: true,
  },
  {
    // #55, appended after `console` so the existing destinations keep their
    // positions (declaration order is navigation order). `ai:use` is the string
    // the consumer `/api/ai/*` controllers enforce, and `feature: 'ai'` hides it
    // while AI is off, when every call it makes answers 403 AI_DISABLED. On the
    // phone bar it lands in "More" once the bar is full.
    key: 'ai',
    label: 'AI Playground',
    compactLabel: 'AI',
    Icon: AutoAwesomeIcon,
    path: '/ai',
    permission: 'ai:use',
    feature: 'ai',
  },
];

/** Which destination, if any, owns `pathname` (longest owning prefix wins). */
export function resolveActiveDestination(pathname: string): DestinationKey | null {
  return resolveShellDestination(DESTINATION_ROUTES, pathname);
}
