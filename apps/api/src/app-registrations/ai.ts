// =============================================================================
// ShellKeep's AI features (issue #55)
// =============================================================================
//
// Registered at import time, before `AiModule.forRoot()` (`platform/ai/ai.config.ts`
// imports this file): the registry freezes once the application has bootstrapped.
// Ids are lower snake case (`AI_FEATURE_ID_PATTERN`, no dots) and permanent: they
// key usage records and the `GET /api/ai/features` listing.
//
// A feature never holds a key and never imports a provider SDK: it calls
// `AiService.forUser(userId, { orgId, feature })`. Terminal output reaches a model
// only after redaction and only when the server profile allows it (#56).
// =============================================================================

import { registerAiFeature, type AiFeatureDefinition } from '@marinoscar/platform-api/ai';

/** The terminal and runbook features, in registration order. */
export const SHELLKEEP_AI_FEATURES: readonly AiFeatureDefinition[] = [
  {
    id: 'terminal_assist',
    label: 'Terminal command assist',
    group: 'Terminal',
    needs: ['responses', 'streaming'],
  },
  {
    id: 'terminal_explain',
    label: 'Explain terminal output',
    group: 'Terminal',
    needs: ['responses', 'streaming'],
  },
  {
    id: 'session_summary',
    label: 'Session summaries',
    group: 'Terminal',
    needs: ['responses'],
  },
  {
    id: 'runbook_agent',
    label: 'Runbook AI step',
    group: 'Runbooks',
    needs: ['responses', 'tools'],
  },
  {
    id: 'runbook_draft',
    label: 'Draft a runbook',
    group: 'Runbooks',
    needs: ['responses', 'structured_output'],
  },
];

for (const feature of SHELLKEEP_AI_FEATURES) registerAiFeature(feature);
