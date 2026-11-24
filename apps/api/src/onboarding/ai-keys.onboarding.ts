import type { OnboardingFactDef, OnboardingStepDef } from '@marinoscar/platform-api/onboarding';

import { PERMISSIONS } from '../common/constants/roles.constants';
import { PrismaService } from '../prisma/prisma.service';
import {
  SHELLKEEP_ONBOARDING_FACTS as FACTS,
  SHELLKEEP_ONBOARDING_STEPS as STEPS,
  countDone,
} from './onboarding.ids';

// =============================================================================
// The "add an AI key" onboarding step (issue #70)
// =============================================================================
//
// The platform's onboarding facts have no "caller holds an AI key" fact
// (`PLATFORM_ONBOARDING_FACTS` has only `aiEnabled`), so ShellKeep counts the
// caller's own rows of `user_ai_keys` (per user, no organization, no row-level
// security). A COUNT only: the key material is never selected.
//
// `feature: 'ai'`: while the AI kill switch is off the step is omitted
// (`ONBOARDING_FEATURES`, `platform/onboarding/onboarding-features.adapter.ts`).
// =============================================================================

export const AI_KEY_COUNT_FACT: OnboardingFactDef<number> = {
  id: FACTS.AI_KEY_COUNT,
  resolve: (ctx) => ctx.get(PrismaService).userAiKey.count({ where: { userId: ctx.caller.id } }),
};

export const AI_KEYS_ONBOARDING_FACTS: readonly OnboardingFactDef[] = [AI_KEY_COUNT_FACT];

export const ADD_AI_KEY_STEP: OnboardingStepDef = {
  id: STEPS.ADD_AI_KEY,
  audience: 'user',
  tier: 'recommended',
  order: 40,
  title: 'Add your AI key',
  description: 'Bring your own provider key to explain errors, suggest commands and summarize sessions.',
  actionLabel: 'Add an AI key',
  href: '/settings/ai',
  // The `/api/ai/keys` controller and the AI Keys card enforce exactly this.
  permission: PERMISSIONS.AI_USE,
  feature: 'ai',
  skippable: true,
  facts: [FACTS.AI_KEY_COUNT],
  funnelSql: 'EXISTS (SELECT 1 FROM user_ai_keys k WHERE k.user_id = c.id)',
  evaluate: (facts) => countDone(facts[FACTS.AI_KEY_COUNT]),
};

export const AI_KEYS_ONBOARDING_STEPS: readonly OnboardingStepDef[] = [ADD_AI_KEY_STEP];
