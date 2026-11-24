// The runbooks' app metrics (issue #61). Label `result` only; never a runbook name or a command.

import type { AppMetricDef } from '@marinoscar/platform-api/otel-core';

export const RUNBOOK_DEFINITIONS_SAVED_METRIC = 'runbookDefinitionsSaved';

export type RunbookDefinitionSaveResult = 'created' | 'version_created' | 'unchanged' | 'invalid';

export const RUNBOOK_APP_METRICS: readonly AppMetricDef[] = [
  {
    key: RUNBOOK_DEFINITIONS_SAVED_METRIC,
    name: 'app.runbooks.definitions_saved',
    kind: 'counter',
    unit: '{definition}',
    description: 'Runbook definition saves by result (created, version_created, unchanged, invalid).',
    attributes: { result: { kind: 'enum', values: ['created', 'version_created', 'unchanged', 'invalid'] } },
  },
];
