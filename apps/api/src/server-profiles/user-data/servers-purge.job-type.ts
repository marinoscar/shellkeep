// =============================================================================
// The delegated purge of a user's server profiles (issue #69)
// =============================================================================
//
// `user.data.purge` hands the `ServerProfile` rows to this job instead of deleting them inline, because a
// profile's SSH secrets are not in its row: they live in the credential store (`UserCredentialsService`,
// purpose `ssh`), and only that service may delete them (never raw SQL on `user_credentials`).
//
// Pure constants, so `app-registrations/user-data.ts` can name the type without importing a Nest class.
// The type string is PERMANENT once jobs of this type exist (`test/jobs/job-type-snapshot.spec.ts`).
// =============================================================================

import { z } from 'zod';

/** The job type of the delegated server profile purge. Permanent. */
export const SERVERS_USER_DATA_PURGE_JOB_TYPE = 'servers.user_data.purge';

/** The payload the platform's `delegate.payload(userId)` hands this job. */
export const serversUserDataPurgePayloadSchema = z.object({ userId: z.string().uuid() });
export type ServersUserDataPurgePayload = z.infer<typeof serversUserDataPurgePayloadSchema>;
