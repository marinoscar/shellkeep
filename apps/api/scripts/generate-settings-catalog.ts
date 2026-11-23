/**
 * Generate prisma/catalog/system-settings-defaults.json (issue #47).
 *
 * The seed reads the system settings defaults from this committed snapshot (the
 * production image carries `prisma/` but not `src/`). Until the settings slice is
 * adopted (#48) the source is ShellKeep's own `DEFAULT_SYSTEM_SETTINGS`.
 *
 *   npm run catalog:settings            write the file
 *   npm run catalog:settings -- --check exit 1 when the file is stale
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { DEFAULT_SYSTEM_SETTINGS } from '../src/common/types/settings.types';

const CATALOG_PATH = join(__dirname, '..', 'prisma', 'catalog', 'system-settings-defaults.json');

export function renderSettingsCatalog(): string {
  return `${JSON.stringify(DEFAULT_SYSTEM_SETTINGS, null, 2)}\n`;
}

function main(): void {
  const rendered = renderSettingsCatalog();

  if (process.argv.includes('--check')) {
    let current: string | undefined;
    try {
      current = readFileSync(CATALOG_PATH, 'utf8');
    } catch {
      current = undefined;
    }
    if (current !== rendered) {
      console.error(
        'prisma/catalog/system-settings-defaults.json is stale. Run `npm run catalog:settings` and commit the result.',
      );
      process.exit(1);
    }
    console.log('prisma/catalog/system-settings-defaults.json is up to date');
    return;
  }

  mkdirSync(dirname(CATALOG_PATH), { recursive: true });
  writeFileSync(CATALOG_PATH, rendered);
  console.log(`wrote ${CATALOG_PATH}`);
}

if (require.main === module) {
  main();
}
