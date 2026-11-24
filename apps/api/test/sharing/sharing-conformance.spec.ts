import '../../src/shellkeep.manifest';
import '../../src/app-registrations/registrations';

import { join } from 'node:path';

import { IS_PUBLIC_KEY } from '@marinoscar/platform-api/identity';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';
// Importing the testing entry REGISTERS the `sharing` suite with the harness.
import '@marinoscar/platform-api/sharing/testing';

import { AppModule } from '../../src/app.module';

// =============================================================================
// The sharing slice's conformance suite, run over ShellKeep (issue #71)
// =============================================================================
//
// The invariants of `@marinoscar/platform-api/sharing` (its README, "Conformance suite"), checked
// against THIS application:
//
//   - no file under src/ touches `grants`, `groups`, `group_members` or `group_invites` directly
//     (Prisma delegate or raw SQL): ShellKeep reaches them only through `AccessPolicy`,
//     `accessibleWhere`, `GrantsService` and the slice's own routes;
//   - every model of the composed schema with an `owner_group_id` column is a registered
//     group-owned resource (`ServerProfile` and `Runbook`);
//   - every route reachable from `AppModule` that serves links is behind `LinkGrantGuard` and
//     carries `@Public()` (the slice's own `GET /api/public/links/current`; ShellKeep adds none:
//     both resource types answer 422 ROLE_NOT_GRANTABLE to a link);
//   - the raw-SQL partial unique indexes of the slice are in prisma/migrations;
//   - the registered resource type ids equal the snapshot below.
// =============================================================================

const API_ROOT = join(__dirname, '..', '..');

/**
 * ShellKeep's shareable resource types. A type id is permanent once grants of it exist, so an id
 * leaves this list only with a migration of its grants. Terminal sessions are deliberately absent:
 * each person who may connect opens their own.
 */
const RESOURCE_TYPE_IDS: readonly string[] = ['server_profile', 'runbook'];

runPlatformConformance({
  sourceRoots: [join(API_ROOT, 'src')],
  suites: {
    sharing: {
      schemaPath: join(API_ROOT, 'prisma', 'schema'),
      migrationsDir: join(API_ROOT, 'prisma', 'migrations'),
      rootModule: AppModule,
      isPublic: (target) => Reflect.getMetadata(IS_PUBLIC_KEY, target) === true,
      groupOwnedModels: { ServerProfile: 'server_profile', Runbook: 'runbook' },
      resourceTypeIds: RESOURCE_TYPE_IDS,
      minRoutes: 100,
    },
  },
});
