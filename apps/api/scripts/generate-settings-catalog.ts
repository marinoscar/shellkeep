/**
 * Generate (or check) prisma/catalog/system-settings-defaults.json (issues #47, #48).
 *
 * The seed reads the system settings defaults from this committed snapshot (the
 * production image carries `prisma/` but not `src/`). The source is the system
 * settings namespace registry (`renderSystemSettingsCatalog`).
 *
 *   npm run catalog:settings            write the file
 *   npm run catalog:settings -- --check exit 1 when the file is stale
 *
 * Imports the registry only (no Nest, no Prisma), so it runs on a bare checkout.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  SYSTEM_SETTINGS_CATALOG_RELATIVE_PATH,
  checkSystemSettingsCatalog,
  renderSystemSettingsCatalog,
} from '../src/platform/settings/settings-catalog';

function main(): void {
  const target = resolve(__dirname, '..', SYSTEM_SETTINGS_CATALOG_RELATIVE_PATH);

  if (process.argv.includes('--check')) {
    let current: string | undefined;
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      current = undefined;
    }
    const stale = checkSystemSettingsCatalog(current);
    if (stale) {
      console.error(stale);
      process.exit(1);
    }
    console.log(`${SYSTEM_SETTINGS_CATALOG_RELATIVE_PATH} is up to date`);
    return;
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, renderSystemSettingsCatalog());
  console.log(`wrote ${target}`);
}

if (require.main === module) {
  main();
}
