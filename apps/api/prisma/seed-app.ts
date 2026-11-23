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
// =============================================================================

import type { PrismaClient } from '@prisma/client';

/**
 * Seed ShellKeep's own data, after the platform's.
 *
 * @param _prisma - The seed's Prisma client.
 */
export async function seedApp(_prisma: PrismaClient): Promise<void> {
  // Nothing to seed.
}
