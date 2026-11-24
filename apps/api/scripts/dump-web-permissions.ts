/**
 * Dump the API permission catalog for the web conformance suites (issue #81).
 *
 * `runPlatformWebConformance()` (`apps/web/src/__tests__/conformance.test.ts`)
 * proves that every settings card and destination names a permission the API
 * really has. The web workspace cannot import the API's registries, so it reads
 * this committed snapshot of the permission names instead, the way the API's
 * seed reads `prisma/catalog/permissions.json`.
 *
 *   npm run permissions:dump              write the snapshot
 *   npm run permissions:dump -- --check   exit 1 when the snapshot is stale (CI)
 *
 * The names come from the same registries `catalog:permissions` renders from
 * (the platform slices plus ShellKeep's own registrations). Add a permission by
 * registering it, never by editing the JSON.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Side effect: fills the role and permission registries (platform + ShellKeep).
import '../src/app-registrations/registrations';
import { buildPermissionCatalog } from '@marinoscar/platform-api/core';

const SNAPSHOT_PATH = join(
  __dirname,
  '..',
  '..',
  'web',
  'src',
  '__tests__',
  'fixtures',
  'api-permissions.json',
);

export function renderPermissionSnapshot(): string {
  const names = buildPermissionCatalog()
    .permissions.map((permission) => permission.name)
    .sort();
  return `${JSON.stringify({ permissions: names }, null, 2)}\n`;
}

function main(): void {
  const rendered = renderPermissionSnapshot();

  if (process.argv.includes('--check')) {
    let current: string | undefined;
    try {
      current = readFileSync(SNAPSHOT_PATH, 'utf8');
    } catch {
      current = undefined;
    }
    if (current !== rendered) {
      console.error(
        'apps/web/src/__tests__/fixtures/api-permissions.json is stale. ' +
          'Run `npm run permissions:dump --workspace=api` and commit the result.',
      );
      process.exit(1);
    }
    console.log('api-permissions.json is up to date');
    return;
  }

  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(SNAPSHOT_PATH, rendered);
  console.log(`wrote ${SNAPSHOT_PATH}`);
}

if (require.main === module) {
  main();
}
