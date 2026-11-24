// =============================================================================
// The delegated purge of a user's runbooks (issue #69)
// =============================================================================
//
// `user.data.purge` hands the `Runbook` rows to this job instead of deleting them inline. The platform's
// `keepWhenReferenced` cannot express "keep a group's runbook": it keeps a row when ANY back-relation is
// non-empty, and every runbook has versions. This job decides by ownership: a runbook of the user alone
// goes, a runbook a group owns stays with the group.
//
// Pure constants, so `app-registrations/user-data.ts` can name the type without importing a Nest class.
// The type string is PERMANENT once jobs of this type exist (`test/jobs/job-type-snapshot.spec.ts`).
// =============================================================================

import { z } from 'zod';

/** The job type of the delegated runbook purge. Permanent. */
export const RUNBOOKS_USER_DATA_PURGE_JOB_TYPE = 'runbooks.user_data.purge';

/** The payload the platform's `delegate.payload(userId)` hands this job. */
export const runbooksUserDataPurgePayloadSchema = z.object({ userId: z.string().uuid() });
export type RunbooksUserDataPurgePayload = z.infer<typeof runbooksUserDataPurgePayloadSchema>;
