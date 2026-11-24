import { runInOrg } from '@marinoscar/platform-api/core';
import type { OnboardingFactDef, OnboardingStepDef } from '@marinoscar/platform-api/onboarding';

import { PERMISSIONS } from '../common/constants/roles.constants';
import {
  SHELLKEEP_ONBOARDING_FACTS as FACTS,
  SHELLKEEP_ONBOARDING_STEPS as STEPS,
  countDone,
  requireActiveOrg,
} from '../onboarding/onboarding.ids';
import { PrismaService } from '../prisma/prisma.service';

// =============================================================================
// Runbooks' onboarding contribution (issue #70)
// =============================================================================
//
// The runbook count fact and the "first runbook" step. Listed in
// `app-registrations/onboarding.ts`.
//
// `runbooks` is under FORCED row-level security, so the count runs inside
// `runInOrg` (one transaction whose first statement sets `app.org_id` and
// `app.user_id`, transaction-local). It counts the runbooks the caller authored
// (`owner_user_id`) that are not archived.
//
// No `funnelSql`: the metrics' aggregate runs outside any organization scope, so
// a predicate over `runbooks` would always read zero rows under RLS.
// =============================================================================

export const RUNBOOK_COUNT_FACT: OnboardingFactDef<number> = {
  id: FACTS.RUNBOOK_COUNT,
  resolve: (ctx) => {
    const orgId = requireActiveOrg(ctx.caller.activeOrgId);
    const userId = ctx.caller.id;
    return runInOrg(ctx.get(PrismaService), { userId, orgId }, (tx) =>
      tx.runbook.count({ where: { orgId, ownerUserId: userId, archivedAt: null } }),
    );
  },
};

export const RUNBOOKS_ONBOARDING_FACTS: readonly OnboardingFactDef[] = [RUNBOOK_COUNT_FACT];

export const FIRST_RUNBOOK_STEP: OnboardingStepDef = {
  id: STEPS.FIRST_RUNBOOK,
  audience: 'user',
  tier: 'recommended',
  order: 50,
  title: 'Create your first runbook',
  description: 'Write down a procedure once as ordered steps, then run it on one server or many.',
  actionLabel: 'Open runbooks',
  // The Runbooks list (#65), where "New runbook" opens the builder.
  href: '/runbooks',
  permission: PERMISSIONS.RUNBOOKS_WRITE,
  skippable: true,
  facts: [FACTS.RUNBOOK_COUNT],
  evaluate: (facts) => countDone(facts[FACTS.RUNBOOK_COUNT]),
};

export const RUNBOOKS_ONBOARDING_STEPS: readonly OnboardingStepDef[] = [FIRST_RUNBOOK_STEP];
