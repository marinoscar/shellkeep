// =============================================================================
// The onboarding slice (issue #70)
// =============================================================================
//
// One `OnboardingModule.forRoot()`: `GET /api/onboarding` (`user_settings:read`,
// the Getting started checklist and, for an administrator, the Doctor-backed
// Setup guide) and `GET /api/admin/onboarding/metrics` (activation metrics),
// from `@marinoscar/platform-api/onboarding`. The admin block and the metrics
// gate on the default `system_settings:read` (the Doctor's, whose report the
// admin steps reuse); the web's Setup guide card declares the same literal.
//
// The steps, facts and milestone are static registries filled by the app's
// composition root (`shellkeep.manifest.ts`) before this module is built; base
// code here names none of them.
// =============================================================================

import { OnboardingModule } from '@marinoscar/platform-api/onboarding';

import { OnboardingHostModule } from './onboarding-host.module';

export const onboardingModule = OnboardingModule.forRoot({ imports: [OnboardingHostModule] });
