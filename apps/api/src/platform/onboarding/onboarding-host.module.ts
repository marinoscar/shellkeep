// =============================================================================
// The onboarding slice's host ports (issue #70)
// =============================================================================
//
// Passed to `OnboardingModule.forRoot({ imports: [OnboardingHostModule] })`
// (./onboarding.config.ts). `PrismaService` comes from the global
// `PrismaModule`; the AI kill switch (`AiConfigService`) from the app's one
// `AiModule` (`../ai/ai.config.ts`), never a second `forRoot()`.
// =============================================================================

import { Module } from '@nestjs/common';
import { ONBOARDING_DATA, ONBOARDING_FEATURES } from '@marinoscar/platform-api/onboarding';

import { AiModule } from '../ai/ai.config';
import { OnboardingDataAdapter } from './onboarding-data.adapter';
import { OnboardingFeaturesAdapter } from './onboarding-features.adapter';

const PORTS = [
  { provide: ONBOARDING_DATA, useClass: OnboardingDataAdapter },
  { provide: ONBOARDING_FEATURES, useClass: OnboardingFeaturesAdapter },
];

@Module({
  imports: [AiModule],
  providers: PORTS,
  exports: PORTS.map((port) => port.provide),
})
export class OnboardingHostModule {}
