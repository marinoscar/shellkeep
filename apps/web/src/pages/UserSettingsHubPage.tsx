/**
 * Settings (`/settings`), the per-user hub (issue #48).
 *
 * A thin binding of the packaged `SettingsHub`
 * (`@marinoscar/platform-web/settings/ui`) over `USER_SETTINGS_SECTIONS`. All
 * behaviour (the card grid, the drill-down list below `sm`, search, the empty
 * state) is the package's; this file contributes the registry, its scroll key
 * and its prose, plus the version line (`AppVersionLine`, #147) the packaged
 * hub has no slot for; it must never grow its own rendering.
 *
 * No `RequirePermission` on the route: every signed-in user owns their own
 * settings, and the registry declares no card permission.
 */

import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { useSettingsFeatures } from '@marinoscar/platform-web/settings/headless';
import { SettingsHub } from '@marinoscar/platform-web/settings/ui';
import { USER_SETTINGS_SECTIONS, USER_HUB_TITLE } from '../config/userSettingsSections';
import { AppVersionLine } from '../components/settings/AppVersionLine';

export default function UserSettingsHubPage() {
  const { hasPermission } = usePermissions();
  return (
    <>
      <SettingsHub
        sections={USER_SETTINGS_SECTIONS}
        hubKey="user-settings-hub"
        title={USER_HUB_TITLE}
        subtitle="Manage your account preferences"
        hasPermission={hasPermission}
        features={useSettingsFeatures()}
      />
      {/* PLATFORM-ADOPTION-SHIM(#147): the packaged hub has no footer slot. */}
      <AppVersionLine />
    </>
  );
}
