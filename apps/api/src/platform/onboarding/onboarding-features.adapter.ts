// =============================================================================
// The onboarding slice's ONBOARDING_FEATURES gate (issue #70)
// =============================================================================
//
// The same switches that hide the web's settings cards. ShellKeep registers
// one: `ai`, the AI kill switch of the `ai` system setting (#55). A feature this
// app does not know is off, so a step gated on it is omitted (the platform's
// `orgs` and `telemetry` cards are not feature-gated here: single organization,
// and the telemetry cards carry no feature).
// =============================================================================

import { Injectable } from '@nestjs/common';
import { AiConfigService } from '@marinoscar/platform-api/ai';
import type { OnboardingFeatureGate } from '@marinoscar/platform-api/onboarding';

@Injectable()
export class OnboardingFeaturesAdapter implements OnboardingFeatureGate {
  constructor(private readonly aiConfig: AiConfigService) {}

  async isEnabled(feature: string): Promise<boolean> {
    switch (feature) {
      case 'ai':
        return this.aiConfig.isEnabled();
      default:
        return false;
    }
  }
}
