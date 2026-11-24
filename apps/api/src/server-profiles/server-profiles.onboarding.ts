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
// Server profiles' onboarding contribution (issue #70)
// =============================================================================
//
// Two facts (the caller's profiles, and those whose host key they trusted) and
// the first two Getting started steps. Listed in `app-registrations/onboarding.ts`.
//
// Each fact is ONE read-only COUNT over the caller's own rows (`user_id` is the
// caller, `org_id` the request's organization): no hostname, no row content.
// `server_profiles` is not under row-level security, so the plain client is used,
// with the organization named next to the owner.
// =============================================================================

export const SERVER_PROFILE_COUNT_FACT: OnboardingFactDef<number> = {
  id: FACTS.SERVER_PROFILE_COUNT,
  resolve: (ctx) =>
    ctx.get(PrismaService).serverProfile.count({
      where: { userId: ctx.caller.id, orgId: requireActiveOrg(ctx.caller.activeOrgId) },
    }),
};

/** A profile counts as trusted once a fingerprint is stored: the host-key flow of #60 writes it on trust. */
export const TRUSTED_HOST_KEY_COUNT_FACT: OnboardingFactDef<number> = {
  id: FACTS.TRUSTED_HOST_KEY_COUNT,
  resolve: (ctx) =>
    ctx.get(PrismaService).serverProfile.count({
      where: {
        userId: ctx.caller.id,
        orgId: requireActiveOrg(ctx.caller.activeOrgId),
        fingerprint: { not: null },
      },
    }),
};

export const SERVER_PROFILES_ONBOARDING_FACTS: readonly OnboardingFactDef[] = [
  SERVER_PROFILE_COUNT_FACT,
  TRUSTED_HOST_KEY_COUNT_FACT,
];

export const ADD_SERVER_STEP: OnboardingStepDef = {
  id: STEPS.ADD_SERVER,
  audience: 'user',
  tier: 'required',
  order: 10,
  title: 'Add a server',
  description: 'Save the address, user and credentials of a machine you want to reach over SSH.',
  actionLabel: 'Add a server',
  // The Servers page opens its create dialog on `?new=1` (#79).
  href: '/servers?new=1',
  permission: PERMISSIONS.SERVERS_WRITE,
  skippable: false,
  facts: [FACTS.SERVER_PROFILE_COUNT],
  funnelSql: 'EXISTS (SELECT 1 FROM server_profiles sp WHERE sp.user_id = c.id)',
  evaluate: (facts) => countDone(facts[FACTS.SERVER_PROFILE_COUNT]),
};

export const TRUST_HOST_KEY_STEP: OnboardingStepDef = {
  id: STEPS.TRUST_HOST_KEY,
  audience: 'user',
  tier: 'required',
  order: 20,
  title: "Trust your server's host key",
  description:
    'Test the connection, compare the fingerprint with the one your server reports, and trust it so a changed key is refused.',
  actionLabel: 'Open servers',
  href: '/servers',
  // `POST /api/server-profiles/:id/host-key/trust` enforces `servers:write`.
  permission: PERMISSIONS.SERVERS_WRITE,
  skippable: false,
  facts: [FACTS.TRUSTED_HOST_KEY_COUNT, FACTS.SERVER_PROFILE_COUNT],
  funnelSql: 'EXISTS (SELECT 1 FROM server_profiles sp WHERE sp.user_id = c.id AND sp.fingerprint IS NOT NULL)',
  evaluate: (facts) =>
    countDone(
      facts[FACTS.TRUSTED_HOST_KEY_COUNT],
      (facts[FACTS.SERVER_PROFILE_COUNT] as number) > 0
        ? 'Test the connection of a server, then trust the fingerprint it shows.'
        : 'Add a server first; its host key is shown when you test the connection.',
    ),
};

export const SERVER_PROFILES_ONBOARDING_STEPS: readonly OnboardingStepDef[] = [ADD_SERVER_STEP, TRUST_HOST_KEY_STEP];
