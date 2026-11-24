// =============================================================================
// The app's own seed
// =============================================================================
//
// `seed.ts` runs `seedPlatform` (roles, permissions, default grants, the
// `global` system settings row, the initial administrator's allowlist entry, the
// default organization) and then this function. It is the one place ShellKeep
// adds its own seed ROWS. ShellKeep has none: its permissions come from the
// registries (`src/app-registrations/permissions.ts`) through the generated
// catalog (`npm run catalog:permissions`), never from here.
//
// Rules: idempotent (every write an `upsert` on a natural unique), never delete,
// never overwrite a value an administrator may have edited, and Nest-free (this
// file runs under ts-node in an image that carries `prisma/` but not `src/`).
//
// It also runs ShellKeep's one-shot settings data steps, which are idempotent
// and keep every value (they move it): `settings-migrations/terminal-shortcuts.ts`
// moves `terminal.keyShortcuts` to the `shortcuts` namespace (#80).
// =============================================================================

import type { PrismaClient } from '@prisma/client';

import { migrateTerminalShortcuts } from './settings-migrations/terminal-shortcuts';

/**
 * Seed ShellKeep's own data, after the platform's.
 *
 * @param prisma - The seed's Prisma client.
 */
export async function seedApp(prisma: PrismaClient): Promise<void> {
  const moved = await migrateTerminalShortcuts(prisma);
  console.log(`✓ Key shortcuts moved to the shortcuts namespace on ${moved} user settings row(s)`);
}
