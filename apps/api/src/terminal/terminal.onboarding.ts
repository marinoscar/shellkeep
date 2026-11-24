import type {
  ActivationMilestoneDef,
  OnboardingFactDef,
  OnboardingStepDef,
} from '@marinoscar/platform-api/onboarding';

import { PERMISSIONS } from '../common/constants/roles.constants';
import {
  SHELLKEEP_FIRST_SESSION_MILESTONE,
  SHELLKEEP_ONBOARDING_FACTS as FACTS,
  SHELLKEEP_ONBOARDING_STEPS as STEPS,
  countDone,
  requireActiveOrg,
} from '../onboarding/onboarding.ids';
import { PrismaService } from '../prisma/prisma.service';

// =============================================================================
// Terminal sessions' onboarding contribution (issue #70)
// =============================================================================
//
// The session count fact, the "open a session" step and the activation
// milestone (the first terminal session a new user creates). Listed in
// `app-registrations/onboarding.ts`.
//
// The count includes every status (a terminated session still proves the user
// got a shell). `terminal_sessions` is not under row-level security; the
// organization is named next to the owner.
// =============================================================================

export const SESSION_COUNT_FACT: OnboardingFactDef<number> = {
  id: FACTS.SESSION_COUNT,
  resolve: (ctx) =>
    ctx.get(PrismaService).terminalSession.count({
      where: { userId: ctx.caller.id, orgId: requireActiveOrg(ctx.caller.activeOrgId) },
    }),
};

export const TERMINAL_ONBOARDING_FACTS: readonly OnboardingFactDef[] = [SESSION_COUNT_FACT];

export const OPEN_SESSION_STEP: OnboardingStepDef = {
  id: STEPS.OPEN_SESSION,
  audience: 'user',
  tier: 'required',
  order: 30,
  title: 'Open a session',
  description: 'Start a terminal on your server. It keeps running in tmux after you close the tab.',
  actionLabel: 'New session',
  // The Sessions page opens its create dialog on `?new=1`.
  href: '/sessions?new=1',
  permission: PERMISSIONS.SESSIONS_WRITE,
  skippable: false,
  facts: [FACTS.SESSION_COUNT],
  funnelSql: 'EXISTS (SELECT 1 FROM terminal_sessions ts WHERE ts.user_id = c.id)',
  evaluate: (facts) => countDone(facts[FACTS.SESSION_COUNT]),
};

export const TERMINAL_ONBOARDING_STEPS: readonly OnboardingStepDef[] = [OPEN_SESSION_STEP];

/**
 * The event onboarding exists to cause: a new user opens their first terminal
 * session within a week of signing up. Aggregate SQL only; no hostname or session
 * name reaches the metrics.
 */
export const FIRST_SESSION_MILESTONE: ActivationMilestoneDef = {
  id: SHELLKEEP_FIRST_SESSION_MILESTONE,
  label: 'First terminal session opened',
  windowDays: 7,
  firstReachedAtSql: '(SELECT MIN(ts.created_at) FROM terminal_sessions ts WHERE ts.user_id = c.id)',
};
