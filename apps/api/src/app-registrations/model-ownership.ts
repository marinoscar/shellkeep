// =============================================================================
// ShellKeep's model ownership classification (issue #47)
// =============================================================================
//
// Every ShellKeep model is classified (`user`, `org`, `org-optional` or
// `system`); the `user-owned-data` conformance suite fails on any model it
// cannot find here. ShellKeep is single-organization: terminal content belongs
// to a USER. The two domain tables carry `org_id` as a REFERENCE (the
// organization the row was created in), not as an isolation key: they are not
// under row-level security (docs/platform-adoption/local-exceptions.md).
//
// ONE-LINE RATIONALE EACH, because the tripwire prints it when it fails.
// =============================================================================

import type { Prisma } from '@prisma/client';
import type { ModelOwnershipDef } from '@marinoscar/platform-api/core';

type Def = ModelOwnershipDef<Prisma.ModelName>;

export const APP_MODEL_OWNERSHIP: readonly Def[] = [
  {
    model: 'ServerProfile',
    kind: 'user',
    orgReference: 'orgId',
    rationale: 'A server profile belongs to the user who created it; org_id records the organization, it is not an isolation key.',
  },
  {
    model: 'TerminalSession',
    kind: 'user',
    orgReference: 'orgId',
    rationale: 'A terminal session belongs to the user who opened it; org_id records the organization, it is not an isolation key.',
  },
];
