// =============================================================================
// The generated system settings defaults catalog (issue #48)
// =============================================================================
//
// `prisma/seed.ts` runs under `ts-node --transpile-only` from `apps/api/prisma`,
// and the production image carries `prisma/` but not `src/`. So the seed cannot
// import the registry; it reads a COMMITTED, GENERATED copy,
// `prisma/catalog/system-settings-defaults.json`, rendered by this function
// (`npm run catalog:settings --workspace=api`). The staleness check (`--check`,
// and `test/settings/settings-catalog.spec.ts`) renders it again and compares, so
// a namespace whose defaults change without regenerating the file fails with the
// fix command in the message.
// =============================================================================

import {
  checkSystemSettingsCatalog as checkCatalog,
  renderSystemSettingsCatalog as renderCatalog,
} from '@marinoscar/platform-api/settings';

import './registry';

/** The catalog's path, relative to `apps/api`. */
export const SYSTEM_SETTINGS_CATALOG_RELATIVE_PATH = 'prisma/catalog/system-settings-defaults.json';

/** The fix a stale catalog asks for. */
export const SETTINGS_CATALOG_STALE_MESSAGE = `${SYSTEM_SETTINGS_CATALOG_RELATIVE_PATH} is stale: run npm run catalog:settings --workspace=api`;

/** The catalog file's exact contents: the composed system defaults as 2-space JSON, key order preserved. */
export function renderSystemSettingsCatalog(): string {
  return renderCatalog();
}

/** Compares a catalog file's contents (`undefined` when missing) with what would be rendered. */
export function checkSystemSettingsCatalog(contents: string | undefined): string | null {
  return checkCatalog(contents, SETTINGS_CATALOG_STALE_MESSAGE);
}
