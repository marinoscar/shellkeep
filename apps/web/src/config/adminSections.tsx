/**
 * The admin settings information architecture (issue #46): the registry the
 * packaged `SettingsHub` (`@marinoscar/platform-web/settings/ui`) draws at
 * `/admin/settings`, bound in `pages/AdminSettingsHubPage.tsx`.
 *
 * DATA ONLY. Every card has a route in `App.tsx`, gated by `RequirePermission`
 * on the card's `permission`; a route without a card here is not allowed
 * (Settings UI Pattern, AGENTS.md). Append new cards; never insert between
 * existing ones.
 *
 * Each `permission` is the exact string the API controller enforces on the
 * page's GET, never an invented one. Writes are gated inside each page:
 *
 *   - About: `GET /api/admin/about`, `system_settings:read` (the host slice's
 *     `AboutModule`; there is deliberately no `about:read`).
 *   - Maintenance: `GET /api/admin/maintenance`, `system_settings:read`; the
 *     `PUT` needs `system_settings:write`, gated by the packaged page. The path
 *     is the host slice's `MAINTENANCE_ADMIN_PATH`, which `MaintenanceGate`
 *     never gates.
 *   - Terminal: `GET /api/system-settings`, `system_settings:read`; saving
 *     needs `system_settings:write`, gated inside the page.
 *   - Users & Allowlist: the identity slice's card (`users:read`).
 *   - Doctor: `GET /api/admin/doctor`, `system_settings:read` (the packaged
 *     page's descriptor).
 *
 * The composition root: the `Terminal` card is the terminal domain's
 * (`components/terminal/settings/TerminalSystemSettingsPage.tsx`), declared
 * here so the base code never names the domain.
 */

import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import BuildCircleOutlinedIcon from '@mui/icons-material/BuildCircleOutlined';
import TerminalIcon from '@mui/icons-material/Terminal';
import type { SettingsSectionDef } from '@marinoscar/platform-web/settings/ui';
import { doctorSettingsPage } from '@marinoscar/platform-web/doctor/ui';
import { identityAdminSections } from '@marinoscar/platform-web/identity/ui';
import {
  TERMINAL_SYSTEM_SETTINGS_DESCRIPTION,
  TERMINAL_SYSTEM_SETTINGS_TITLE,
} from '../components/terminal/settings/TerminalSystemSettingsPage';

/** The route of the About page. */
export const ABOUT_PATH = '/admin/settings/about';
/** The route of the Maintenance page: the host slice's `MAINTENANCE_ADMIN_PATH`. */
export const MAINTENANCE_PATH = '/admin/settings/maintenance';
/** The route of the admin Terminal page. */
export const TERMINAL_SYSTEM_SETTINGS_PATH = '/admin/settings/terminal';

/** The admin settings sections, in hub order. */
export const ADMIN_SECTIONS: SettingsSectionDef[] = [
  {
    label: 'General',
    cards: [
      {
        title: 'About',
        description:
          'Which version of the application is running, where it was deployed from, and when.',
        Icon: InfoOutlinedIcon,
        path: ABOUT_PATH,
        permission: 'system_settings:read',
      },
      {
        title: 'Maintenance',
        description:
          'Take the application out of service for planned work, with a message for anyone who tries to use it.',
        Icon: BuildCircleOutlinedIcon,
        path: MAINTENANCE_PATH,
        permission: 'system_settings:read',
      },
      {
        title: TERMINAL_SYSTEM_SETTINGS_TITLE,
        description: TERMINAL_SYSTEM_SETTINGS_DESCRIPTION,
        Icon: TerminalIcon,
        path: TERMINAL_SYSTEM_SETTINGS_PATH,
        permission: 'system_settings:read',
      },
    ],
  },
  {
    label: 'Access',
    // `Users & Allowlist`, `/admin/settings/users`, `users:read`. Copied field
    // by field: the identity card type admits the `orgs` and `oauthServer`
    // features, which ShellKeep does not register, and the access card uses
    // neither.
    cards: identityAdminSections.access.map(({ title, description, Icon, path, permission }) => ({
      title,
      description,
      Icon,
      path,
      permission,
    })),
  },
  {
    label: 'Observability',
    cards: [{ ...doctorSettingsPage.card, Icon: doctorSettingsPage.Icon }],
  },
];

/** The admin hub: the one `/admin/settings` route that owns no card. */
export const ADMIN_HUB_PATH = '/admin/settings';
export const ADMIN_HUB_TITLE = 'System Settings';

/**
 * Every permission a card of {@link ADMIN_SECTIONS} declares: the hub route
 * admits a viewer holding any of them (the hub then shows only their cards).
 */
export const ADMIN_HUB_PERMISSIONS: string[] = [
  ...new Set(
    ADMIN_SECTIONS.flatMap((section) =>
      section.cards.flatMap((card): readonly string[] => {
        if (!card.permission) return [];
        return typeof card.permission === 'string' ? [card.permission] : card.permission;
      }),
    ),
  ),
];
