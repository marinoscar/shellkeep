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
// The runbook tables (#61) are the exception: org tables under forced row-level security.
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
  {
    model: 'Runbook',
    kind: 'org',
    orgField: 'orgId',
    rationale: 'A runbook belongs to the organization (owner_user_id is only its author): isolated by forced row-level security on org_id.',
  },
  {
    model: 'RunbookVersion',
    kind: 'org',
    orgField: 'orgId',
    rationale: 'An immutable version of an organization-owned runbook: isolated by forced row-level security on org_id.',
  },
  {
    model: 'RunbookRun',
    kind: 'org',
    orgField: 'orgId',
    rationale: 'A run of an organization-owned runbook (initiated_by is only who started it): isolated by forced row-level security on org_id.',
  },
  {
    model: 'RunbookRunTarget',
    kind: 'org',
    orgField: 'orgId',
    rationale: 'One server of a run: isolated by forced row-level security on org_id.',
  },
  {
    model: 'RunbookRunStep',
    kind: 'org',
    orgField: 'orgId',
    rationale: 'One step on one target of a run: isolated by forced row-level security on org_id.',
  },
  {
    model: 'RunbookRunLogChunk',
    kind: 'org',
    orgField: 'orgId',
    rationale: 'A buffered chunk of a step output: isolated by forced row-level security on org_id.',
  },
  {
    model: 'RunbookCommandExecution',
    kind: 'org',
    orgField: 'orgId',
    rationale: 'The audit row of one command a runbook sent over SSH: isolated by forced row-level security on org_id.',
  },
  {
    model: 'RunbookApproval',
    kind: 'org',
    orgField: 'orgId',
    rationale: 'An approval request of a run: isolated by forced row-level security on org_id.',
  },
];
