// =============================================================================
// The sharing slice, configured once (issue #71)
// =============================================================================
//
// `@marinoscar/platform-api/sharing`: groups, members and invites (`/api/groups`), grants
// (`/api/grants`), the "shared with me" list, the grants prune job and the
// `sharing.groups.orphaned` Doctor check. The routes are guarded by the app's own `@Auth()`
// (`platformHost`); every app capability reaches the slice through `SharingHostModule`.
//
// Group limits, invite lifetime and the grant retention keep the slice's defaults. The membership
// cache shares the identity principal cache's TTL (`AUTH_PRINCIPAL_CACHE_TTL_SECONDS`), so the two
// caches expire together. Link URLs are built on the deployment's `APP_URL`; the slice has no switch
// that turns links off, so ShellKeep disables them per resource type (`grantable.link: []` in
// `app-registrations/sharing.ts`): `POST /api/grants/links` answers 422 ROLE_NOT_GRANTABLE. The one linkable
// type is `runbook_run` (#63), whose links default to 7 days and are capped at 30 (`links` below).
//
// The resource types (`server_profile`, `runbook`) are registered at import time by
// `app-registrations/sharing.ts`, before this module composes.
// =============================================================================

import { parsePrincipalCacheTtlSeconds } from '@marinoscar/platform-api/identity';
import { SharingModule } from '@marinoscar/platform-api/sharing';

import { platformHost } from '../platform-host';
import { SharingHostModule } from './sharing-host.module';

const DEFAULT_APP_URL = 'http://localhost:3535';

/** The slice, mounted once in `AppModule`. */
export const sharingModule = SharingModule.forRoot({
  host: platformHost,
  imports: [SharingHostModule],
  groups: {
    membershipCacheTtlSeconds: parsePrincipalCacheTtlSeconds(process.env.AUTH_PRINCIPAL_CACHE_TTL_SECONDS),
  },
  links: {
    appUrl: () => process.env.APP_URL || DEFAULT_APP_URL,
    // A link to a run's log bundle (#63) lives 7 days unless the sharer picks another, and never past 30.
    defaultTtlDays: 7,
    maxTtlDays: 30,
  },
});
