// =============================================================================
// The settings slice's composition (issue #48)
// =============================================================================
//
// `SettingsModule.forRoot` serves `GET|PUT|PATCH /api/system-settings`,
// `GET|PUT|PATCH /api/user-settings` and `/api/org-settings` (unused in
// single-organization mode), and provides `SystemSettingsService`,
// `UserSettingsService`, `SettingsResolver` and `SystemSettingsRowStore`
// globally. Replaces ShellKeep's own `settings/` module.
//
// IT MUST RUN AFTER THE NAMESPACE REGISTRATION: the request bodies and the
// OpenAPI document are composed from the registries when `forRoot` runs, so the
// import below comes first. `systemRowKey` stays `'global'` (the row ShellKeep
// has always used; never change it on an existing database) and `orgLayer` is
// `'auto'`: in single-organization mode an organization layer applies only when
// its row exists, which here it never does.
// =============================================================================

import './registry';

import { SettingsModule } from '@marinoscar/platform-api/settings';

import { SettingsHostModule } from './settings-host.module';

export const settingsModule = SettingsModule.forRoot({
  systemRowKey: 'global',
  orgLayer: 'auto',
  imports: [SettingsHostModule],
});
