/**
 * The per-user settings information architecture (issue #48): the registry the
 * packaged `SettingsHub` (`@marinoscar/platform-web/settings/ui`) draws at
 * `/settings`, bound in `pages/UserSettingsHubPage.tsx`.
 *
 * DATA ONLY. The `SettingsSectionDef` type and the gates
 * (`visibleSettingsSections`, `settingsPageTitle`) are the package's. Every
 * card has a route in `App.tsx`; a route without a card here is not allowed
 * (Settings UI Pattern, AGENTS.md). Append new cards; never insert between
 * existing ones.
 *
 * NO CARD DECLARES A `permission`: the API grants `user_settings:read` and
 * `user_settings:write` to every role, so a gate here would invent an
 * authorization rule the API does not enforce.
 *
 * The composition root: the `Terminal` card is the terminal domain's
 * (`components/terminal/settings/TerminalSettingsPage.tsx`), declared here so
 * the base settings code never names the domain. It replaces the transitional
 * `config/userSettingsPanels.tsx` of #44.
 */

import PersonIcon from '@mui/icons-material/Person';
import PaletteIcon from '@mui/icons-material/Palette';
import TerminalIcon from '@mui/icons-material/Terminal';
import NotificationsIcon from '@mui/icons-material/Notifications';
import type { SettingsSectionDef } from '@marinoscar/platform-web/settings/ui';
import { identityUserSettingsSections } from '@marinoscar/platform-web/identity/ui';
import {
  TERMINAL_SETTINGS_DESCRIPTION,
  TERMINAL_SETTINGS_TITLE,
} from '../components/terminal/settings/TerminalSettingsPage';

/** The user settings sections, in hub order. */
export const USER_SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    label: 'Account',
    cards: [
      {
        // The packaged `UserProfilePage`; its own h1 and description match.
        title: 'Profile',
        description:
          'Your display name, profile image and time zone, and the email you signed in with.',
        Icon: PersonIcon,
        path: '/settings/profile',
      },
      {
        // The packaged `UserAppearancePage`.
        title: 'Appearance',
        description: 'Choose a light, dark, or system-matched theme for this account.',
        Icon: PaletteIcon,
        path: '/settings/appearance',
      },
      {
        // #51, appended: the packaged `UserNotificationsPage`, the caller's
        // own event x channel matrix. No permission, like its siblings
        // (`GET /api/notifications/events` and `/channels` need only a
        // session; the preferences live in the caller's user settings).
        title: 'Notifications',
        description:
          'Choose which events notify you, and whether they arrive by email, in the app or as a push notification.',
        Icon: NotificationsIcon,
        path: '/settings/notifications',
      },
    ],
  },
  {
    label: 'Workspace',
    cards: [
      {
        title: TERMINAL_SETTINGS_TITLE,
        description: TERMINAL_SETTINGS_DESCRIPTION,
        Icon: TerminalIcon,
        path: '/settings/terminal',
      },
    ],
  },
  {
    // #76, appended: the identity slice's per-user cards (#47), as data.
    // `Access Tokens` (`/settings/tokens`, the packaged `UserTokensPage` over
    // `/api/pat`; no permission, every signed-in user manages their own).
    // `connectedApps` is not spread: ShellKeep runs no OAuth server.
    label: 'Security',
    cards: identityUserSettingsSections.security.map(({ title, description, Icon, path }) => ({
      title,
      description,
      Icon,
      path,
    })),
  },
];

/** The user settings hub: the one `/settings` route that owns no card. */
export const USER_HUB_PATH = '/settings';
export const USER_HUB_TITLE = 'Settings';
