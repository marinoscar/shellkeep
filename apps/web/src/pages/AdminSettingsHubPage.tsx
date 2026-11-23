/**
 * System Settings (`/admin/settings`), the admin hub (issue #46).
 *
 * A thin binding of the packaged `SettingsHub`
 * (`@marinoscar/platform-web/settings/ui`) over `ADMIN_SECTIONS`, the same
 * component `/settings` binds. All behaviour (the card grid, the drill-down
 * list below `sm`, search, the per-card permission gate) is the package's;
 * this file contributes the registry, its scroll key and its prose.
 *
 * The route admits a viewer holding any card's permission
 * (`ADMIN_HUB_PERMISSIONS`); the hub shows only the cards they may open.
 */

import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { useSettingsFeatures } from '@marinoscar/platform-web/settings/headless';
import { SettingsHub } from '@marinoscar/platform-web/settings/ui';
import { ADMIN_HUB_TITLE, ADMIN_SECTIONS } from '../config/adminSections';

export default function AdminSettingsHubPage() {
  const { hasPermission } = usePermissions();
  return (
    <SettingsHub
      sections={ADMIN_SECTIONS}
      hubKey="admin-settings-hub"
      title={ADMIN_HUB_TITLE}
      subtitle="Manage system configuration and see how the deployment is doing."
      hasPermission={hasPermission}
      features={useSettingsFeatures()}
    />
  );
}
