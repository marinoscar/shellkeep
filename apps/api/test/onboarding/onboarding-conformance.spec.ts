// =============================================================================
// The onboarding slice's conformance suite (issue #70)
// =============================================================================
//
// `runPlatformConformance({ suites: { onboarding } })`: every step reads
// registered facts and names a registered permission, no required step is
// skippable, ShellKeep registered its steps, each fact resolves at most once per
// derivation and step evaluation does no I/O.
//
// Its own file because importing `@marinoscar/platform-api/onboarding/testing`
// registers the suite, and the registries are filled by the composition root,
// exactly as `main.ts` fills them. ShellKeep's facts read through app providers
// (`ctx.get(PrismaService)`), which the probe does not have, so they get samples.
// =============================================================================
import '../../src/shellkeep.manifest';

import { join } from 'node:path';

import { permissionRegistry } from '@marinoscar/platform-api/core';
import '@marinoscar/platform-api/onboarding/testing';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';

import { SHELLKEEP_ONBOARDING_FACTS } from '../../src/onboarding/onboarding.ids';

runPlatformConformance({
  sourceRoots: [join(__dirname, '..', '..', 'src')],
  suites: {
    onboarding: {
      permissions: permissionRegistry.list(),
      factSamples: Object.fromEntries(Object.values(SHELLKEEP_ONBOARDING_FACTS).map((id) => [id, 0])),
      // The platform's nine steps plus ShellKeep's five.
      minSteps: 14,
    },
  },
});
