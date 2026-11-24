// The terminal AI app metrics (issue #56). Label `kind` only (a redaction kind); never a session,
// server, user or organization, and never any text.

import type { AppMetricDef } from '@marinoscar/platform-api/otel-core';

import { REDACTION_KINDS } from '../command-safety';

export const TERMINAL_AI_REDACTIONS_METRIC = 'terminalAiRedactions';

export const TERMINAL_AI_APP_METRICS: readonly AppMetricDef[] = [
  {
    key: TERMINAL_AI_REDACTIONS_METRIC,
    name: 'app.terminal_ai.redactions',
    kind: 'counter',
    unit: '{redaction}',
    description: 'Secrets redacted from terminal output before it reached an AI feature, by kind.',
    attributes: { kind: { kind: 'enum', values: [...REDACTION_KINDS] } },
  },
];
