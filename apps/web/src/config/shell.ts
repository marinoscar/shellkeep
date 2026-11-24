/**
 * This app's binding of the platform shell (`@marinoscar/platform-web/shell`,
 * issue #76): the ONE navigation object every shell surface reads.
 *
 *   - `destinations` / `destinationRoutes`: the destination model
 *     (`config/destinations.ts`), so the rail, the bottom bar and the user menu
 *     draw the same table behind the same gates;
 *   - `settingsSurfaces`: what the compact AppBar drills into below `sm`, in
 *     resolution order (the Console first, then the per-user hub);
 *   - `console`: the rail's Console mode on any `/admin` route, listing
 *     `ADMIN_SECTIONS` with the hub's permission and feature filter, and a way
 *     back to the work surfaces;
 *   - `useRailPreference`: the packaged hook, which keeps the desktop rail's
 *     collapse choice in the viewer's `navigation` user settings.
 *
 * Declared once at module scope: the shell compares it by reference.
 */
import { useShellRailPreference } from '@marinoscar/platform-web/shell/headless';
import type { ShellNavigation } from '@marinoscar/platform-web/shell/headless';
import { APP_NAME } from './app';
import { ADMIN_HUB_PATH, ADMIN_HUB_TITLE, ADMIN_SECTIONS } from './adminSections';
import { DESTINATIONS, DESTINATION_ROUTES } from './destinations';
import type { DestinationKey } from './destinations';
import { USER_HUB_PATH, USER_HUB_TITLE, USER_SETTINGS_SECTIONS } from './userSettingsSections';

/** The Console's way out of Console mode. */
export const CONSOLE_BACK = { label: `Back to ${APP_NAME}`, path: '/' } as const;

export const SHELLKEEP_NAVIGATION: ShellNavigation<DestinationKey> = {
  destinations: DESTINATIONS,
  destinationRoutes: DESTINATION_ROUTES,
  settingsSurfaces: [
    { sections: ADMIN_SECTIONS, hubPath: ADMIN_HUB_PATH, hubTitle: ADMIN_HUB_TITLE },
    { sections: USER_SETTINGS_SECTIONS, hubPath: USER_HUB_PATH, hubTitle: USER_HUB_TITLE },
  ],
  console: { prefix: '/admin', sections: ADMIN_SECTIONS, back: CONSOLE_BACK },
  homePath: '/',
  useRailPreference: useShellRailPreference,
};
