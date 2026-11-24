// =============================================================================
// `runbook_run`: the one resource type of ShellKeep that may be shared by LINK (issue #63)
// =============================================================================
//
// A person who started a run can hand its log bundle to someone outside ShellKeep (a vendor, another team)
// with a link: `POST /api/grants/links` (the sharing slice's route, `sharing:write`) for resource type
// `runbook_run`. The link opens ONLY the public bundle route (`GET /api/public/runbook-runs/bundle`).
//
//   roles       viewer
//   actions     read -> viewer (what the public route needs: the link's role reaches it);
//               share -> owner (the person who started the run: nobody else holds a role on a run)
//   RBAC on top read and share need `runbooks:read`, as a run's own routes do
//   owner       the run's initiator; a run nobody started (a schedule) has no owner, so no one can share it
//   grantable   LINKS ONLY (`user` and `group` are empty): a run is never granted to another account
//   lifetime    7 days by default, 30 at most (the sharing module's `links` options, `sharing.config.ts`)
//
// The type id `runbook_run` is PERMANENT once a grant exists (a grant row stores the string); if the feature
// is ever reverted, keep the type registered read-only so existing links keep resolving to a clean 404.
// A sharer who is not the initiator cannot link a run even when they may read it: a link is the initiator's
// decision, and granting it to every reader of the runbook would let a reader of one shared runbook publish
// a run they only happen to see.
// =============================================================================

import type { Prisma } from '@prisma/client';
import { registerResourceType, type ResourceDescription, type ResourceOwnerInfo } from '@marinoscar/platform-api/sharing';

export const RUNBOOK_RUN_RESOURCE = 'runbook_run';
export const RUNBOOK_RUN_ROLES = ['viewer'] as const;
type RunRole = (typeof RUNBOOK_RUN_ROLES)[number];

/** Stands in for the owner of a run nobody started: matches no principal. */
const NOBODY = '00000000-0000-0000-0000-000000000000';

const asTx = (tx: unknown): Prisma.TransactionClient => tx as Prisma.TransactionClient;

let registered = false;

/** Idempotent per process. Called by `registerShellkeepSharing` at import time, before the registries freeze. */
export function registerRunbookRunResource(): void {
  if (registered) return;
  registered = true;
  registerResourceType<RunRole>({
    type: RUNBOOK_RUN_RESOURCE,
    roles: RUNBOOK_RUN_ROLES,
    actions: { read: 'viewer', share: 'owner' },
    actionPermissions: { read: 'runbooks:read', share: 'runbooks:read' },
    ownership: 'user',
    grantable: { user: [], group: [], link: ['viewer'] },
    async loadOwners(ids, tx) {
      const rows = await asTx(tx).runbookRun.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, orgId: true, initiatedBy: true },
      });
      return new Map<string, ResourceOwnerInfo>(rows.map((row) => [row.id, { orgId: row.orgId, owner: { kind: 'user', userId: row.initiatedBy ?? NOBODY } }]));
    },
    async describe(ids, tx) {
      const rows = await asTx(tx).runbookRun.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, runbook: { select: { name: true } } },
      });
      return new Map<string, ResourceDescription>(rows.map((row) => [row.id, { title: row.runbook.name, path: `/runbooks/runs/${row.id}` }]));
    },
  });
}
