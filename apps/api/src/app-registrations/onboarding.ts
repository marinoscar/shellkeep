// =============================================================================
// ShellKeep's onboarding registrations (issue #70)
// =============================================================================
//
// The grep-able list of what the Getting started checklist is made of, after
// the platform's own facts and steps. Each fact and step is declared beside its
// domain; this file only lists them. Registered by `onboarding/onboarding.manifest.ts`.
//
//   order  step                         fact(s)                               link
//   10     shellkeep.add-server         shellkeep.serverProfileCount          /servers?new=1
//   20     shellkeep.trust-host-key     shellkeep.trustedHostKeyCount         /servers
//   30     shellkeep.open-session       shellkeep.sessionCount                /sessions?new=1
//   40     shellkeep.add-ai-key         shellkeep.aiKeyCount (feature `ai`)   /settings/ai
//   50     shellkeep.first-runbook      shellkeep.runbookCount                /runbooks
//
// STEP IDS ARE PERMANENT (stored in a user's `onboarding.skipped`).
// Pure data: no `register()` calls.
// =============================================================================

import type {
  ActivationMilestoneDef,
  OnboardingFactDef,
  OnboardingStepDef,
} from '@marinoscar/platform-api/onboarding';

import { AI_KEYS_ONBOARDING_FACTS, AI_KEYS_ONBOARDING_STEPS } from '../onboarding/ai-keys.onboarding';
import { RUNBOOKS_ONBOARDING_FACTS, RUNBOOKS_ONBOARDING_STEPS } from '../runbooks/runbooks.onboarding';
import {
  SERVER_PROFILES_ONBOARDING_FACTS,
  SERVER_PROFILES_ONBOARDING_STEPS,
} from '../server-profiles/server-profiles.onboarding';
import {
  FIRST_SESSION_MILESTONE,
  TERMINAL_ONBOARDING_FACTS,
  TERMINAL_ONBOARDING_STEPS,
} from '../terminal/terminal.onboarding';

/** ShellKeep's facts (read-only counts over the caller's own rows). */
export const APP_ONBOARDING_FACTS: readonly OnboardingFactDef[] = [
  ...SERVER_PROFILES_ONBOARDING_FACTS,
  ...TERMINAL_ONBOARDING_FACTS,
  ...AI_KEYS_ONBOARDING_FACTS,
  ...RUNBOOKS_ONBOARDING_FACTS,
];

/** ShellKeep's Getting started steps (audience `user`), in checklist order. */
export const APP_ONBOARDING_STEPS: readonly OnboardingStepDef[] = [
  ...SERVER_PROFILES_ONBOARDING_STEPS,
  ...TERMINAL_ONBOARDING_STEPS,
  ...AI_KEYS_ONBOARDING_STEPS,
  ...RUNBOOKS_ONBOARDING_STEPS,
];

/** The activation milestone the admin metrics report: the first terminal session. */
export const APP_ACTIVATION_MILESTONES: readonly ActivationMilestoneDef[] = [FIRST_SESSION_MILESTONE];
