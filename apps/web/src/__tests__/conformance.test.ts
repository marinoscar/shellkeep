// =============================================================================
// SHELLKEEP'S WEB CONFORMANCE ENTRY (issue #76)
// =============================================================================
//
// Every invariant the platform enforces over what the web app DECLARES (its
// settings registries, its route table, its destinations, its shell) runs HERE
// through `runPlatformWebConformance()`, so the suite ids and cases are the
// same in every app on `@marinoscar/platform-web`. This file passes the data:
//   - the registries are the arrays the hubs, the rail and the AppBar title run;
//   - the route table is the text of `App.tsx`, parsed for its `<Route>`s;
//   - the permission ids are the generated catalog the API seeds from
//     (`apps/api/prisma/catalog/permissions.json`), so a card or destination
//     can only name a permission the API really has.
// #81 extends it.
// =============================================================================

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runPlatformWebConformance } from '@marinoscar/platform-web/testing';
// Importing a slice's testing entry REGISTERS its suites with the harness.
import '@marinoscar/platform-web/settings/testing';
// shell-local-host and shell-layout-variants (a full-bleed main keeps gate 3).
import '@marinoscar/platform-web/shell/testing';

import { ADMIN_HUB_PATH, ADMIN_HUB_TITLE, ADMIN_SECTIONS } from '../config/adminSections';
import {
  DESTINATIONS,
  DESTINATION_ROUTES,
  UNOWNED_ROUTES,
  owns,
  resolveActiveDestination,
} from '../config/destinations';
import { USER_HUB_PATH, USER_HUB_TITLE, USER_SETTINGS_SECTIONS } from '../config/userSettingsSections';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_TSX = resolve(HERE, '../App.tsx');
const PERMISSION_CATALOG = resolve(HERE, '../../../api/prisma/catalog/permissions.json');

const catalog = JSON.parse(readFileSync(PERMISSION_CATALOG, 'utf8')) as {
  permissions: Array<{ name: string }>;
};
const apiPermissions = catalog.permissions.map((permission) => permission.name);

runPlatformWebConformance({
  adminSections: ADMIN_SECTIONS,
  userSettingsSections: USER_SETTINGS_SECTIONS,
  hubs: {
    admin: { path: ADMIN_HUB_PATH, title: ADMIN_HUB_TITLE },
    user: { path: USER_HUB_PATH, title: USER_HUB_TITLE },
  },
  routes: { appTsx: readFileSync(APP_TSX, 'utf8') },
  apiPermissions,
  destinations: {
    routes: DESTINATION_ROUTES,
    unowned: UNOWNED_ROUTES,
    owns,
    resolveActive: resolveActiveDestination,
    destinations: DESTINATIONS.map((destination) => ({ key: destination.key, path: destination.path })),
  },
  suites: {
    'settings-ai-cards': {
      skip:
        "ShellKeep has not adopted the AI slice yet: the catalog carries the platform's ai:* permissions, but neither registry has an AI card or route. #55 adopts the slice and removes this skip.",
    },
  },
});

// The destinations' gates are not part of a settings registry, so the suites
// above do not see them: check them against the same catalog here.
describe('destinations: permissions the API enforces', () => {
  it('names only permissions in the API permission catalog', () => {
    const named = DESTINATIONS.flatMap((d) => [
      ...(d.permission ? [d.permission] : []),
      ...(d.anyPermission ?? []),
    ]);
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((permission) => !apiPermissions.includes(permission))).toEqual([]);
  });
});
