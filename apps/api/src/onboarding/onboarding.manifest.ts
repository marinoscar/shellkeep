// =============================================================================
// Onboarding manifest (issue #70)
// =============================================================================
//
// Fills the onboarding slice's static registries: the platform's facts and
// steps first (the admin Setup guide, `user.profile`, `user.notifications`),
// then ShellKeep's (`app-registrations/onboarding.ts`), so a collision with a
// platform id names ShellKeep's entry.
//
// IMPORTED BY `shellkeep.manifest.ts`, the composition root every entry point
// loads first: the stored `onboarding` user-settings namespace's merge refuses
// a `skipped` id that is not a registered, skippable step, so the registry must
// be filled in every process that can handle `PATCH /api/user-settings` (the
// OpenAPI dump and the specs included). `OnboardingModule` checks at bootstrap
// that every fact a step names is registered (`assertOnboardingRegistries`).
//
// Module scope runs once per module registry, so no guard flag is needed.
// =============================================================================

import {
  PLATFORM_ONBOARDING_FACTS,
  PLATFORM_ONBOARDING_STEPS,
  registerActivationMilestone,
  registerOnboardingFact,
  registerOnboardingStep,
} from '@marinoscar/platform-api/onboarding';

import {
  APP_ACTIVATION_MILESTONES,
  APP_ONBOARDING_FACTS,
  APP_ONBOARDING_STEPS,
} from '../app-registrations/onboarding';

registerOnboardingFact(...PLATFORM_ONBOARDING_FACTS);
registerOnboardingStep(...PLATFORM_ONBOARDING_STEPS);

registerOnboardingFact(...APP_ONBOARDING_FACTS);
registerOnboardingStep(...APP_ONBOARDING_STEPS);
for (const milestone of APP_ACTIVATION_MILESTONES) registerActivationMilestone(milestone);
