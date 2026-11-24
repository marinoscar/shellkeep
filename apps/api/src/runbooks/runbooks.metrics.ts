// The runbooks' app metrics (issues #61, #62). Bounded labels only (result, status, trigger, origin,
// outcome, kind, decision); never a run, org, server or runbook id, a name or a command.

import type { AppMetricDef } from '@marinoscar/platform-api/otel-core';

export const RUNBOOK_DEFINITIONS_SAVED_METRIC = 'runbookDefinitionsSaved';

export type RunbookDefinitionSaveResult = 'created' | 'version_created' | 'unchanged' | 'invalid';

export const RUNBOOK_RUNS_FINISHED_METRIC = 'runbookRunsFinished';
export const RUNBOOK_TARGET_DURATION_METRIC = 'runbookTargetDuration';
export const RUNBOOK_COMMANDS_METRIC = 'runbookCommands';
export const RUNBOOK_APPROVALS_METRIC = 'runbookApprovals';
export const RUNBOOK_DESTRUCTIVE_RUNS_METRIC = 'runbookDestructiveRuns';
export const RUNBOOK_DRY_RUNS_METRIC = 'runbookDryRuns';
export const RUNBOOK_ARTIFACT_BYTES_METRIC = 'runbookArtifactBytes';
export const RUNBOOK_BUNDLE_BUILDS_METRIC = 'runbookBundleBuilds';

/** What a stored artifact is (#63): a per-server log archive or the zip bundle of a run. */
export const ARTIFACT_KINDS = ['target_archive', 'bundle'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
/** How a bundle build ended (#63). */
export const BUNDLE_OUTCOMES = ['built', 'empty', 'failed'] as const;
export type BundleOutcome = (typeof BUNDLE_OUTCOMES)[number];
const ARTIFACT_BYTES_BUCKETS = [1024, 65_536, 1_048_576, 10_485_760, 104_857_600, 524_288_000, 2_147_483_648];

/** What happened to a destructive run launch (#67): never a run, org, server or runbook id. */
export const DESTRUCTIVE_RUN_OUTCOMES = ['confirmed', 'approved', 'rejected', 'blocked'] as const;
export type DestructiveRunOutcome = (typeof DESTRUCTIVE_RUN_OUTCOMES)[number];

/** Bounded label values of the engine metrics (#62): never a run, org, server or runbook id. */
export const RUN_FINISHED_STATUSES = ['succeeded', 'failed', 'partially_failed', 'aborted', 'cancelled'] as const;
export const RUN_TRIGGERS = ['manual', 'api', 'schedule'] as const;
export const TARGET_DURATION_STATUSES = ['succeeded', 'failed', 'cancelled', 'waiting'] as const;
export const COMMAND_ORIGINS = ['step', 'ai_agent', 'dry_run'] as const;
export const COMMAND_OUTCOMES = ['succeeded', 'failed', 'timed_out', 'cancelled', 'error'] as const;
export const APPROVAL_KINDS = ['step', 'gate', 'destructive_run'] as const;
export const APPROVAL_DECISIONS = ['approved', 'rejected', 'expired'] as const;

const TARGET_DURATION_BUCKETS = [1, 5, 15, 30, 60, 120, 300, 600, 1800, 3600, 14_400];

export const RUNBOOK_APP_METRICS: readonly AppMetricDef[] = [
  {
    key: RUNBOOK_DEFINITIONS_SAVED_METRIC,
    name: 'app.runbooks.definitions_saved',
    kind: 'counter',
    unit: '{definition}',
    description: 'Runbook definition saves by result (created, version_created, unchanged, invalid).',
    attributes: { result: { kind: 'enum', values: ['created', 'version_created', 'unchanged', 'invalid'] } },
  },
  {
    key: RUNBOOK_RUNS_FINISHED_METRIC,
    name: 'app.runbooks.runs_finished',
    kind: 'counter',
    unit: '{run}',
    description: 'Runbook runs that reached a final state, by status and trigger.',
    attributes: {
      status: { kind: 'enum', values: RUN_FINISHED_STATUSES },
      trigger: { kind: 'enum', values: RUN_TRIGGERS },
    },
  },
  {
    key: RUNBOOK_TARGET_DURATION_METRIC,
    name: 'app.runbooks.target_duration',
    kind: 'histogram',
    unit: 's',
    description: 'Time one target spent in one executed segment of a run, by how the segment ended.',
    buckets: TARGET_DURATION_BUCKETS,
    attributes: { status: { kind: 'enum', values: TARGET_DURATION_STATUSES } },
  },
  {
    key: RUNBOOK_COMMANDS_METRIC,
    name: 'app.runbooks.commands',
    kind: 'counter',
    unit: '{command}',
    description: 'Commands a runbook sent over SSH, by origin and outcome.',
    attributes: {
      origin: { kind: 'enum', values: COMMAND_ORIGINS },
      outcome: { kind: 'enum', values: COMMAND_OUTCOMES },
    },
  },
  {
    key: RUNBOOK_APPROVALS_METRIC,
    name: 'app.runbooks.approvals',
    kind: 'counter',
    unit: '{approval}',
    description: 'Runbook approvals decided, by kind (step or canary gate) and decision.',
    attributes: {
      kind: { kind: 'enum', values: APPROVAL_KINDS },
      decision: { kind: 'enum', values: APPROVAL_DECISIONS },
    },
  },
  {
    key: RUNBOOK_DESTRUCTIVE_RUNS_METRIC,
    name: 'app.runbooks.destructive_runs',
    kind: 'counter',
    unit: '{run}',
    description:
      'Destructive runbook run launches: confirmed (typed confirmation accepted), approved or rejected (the second person), blocked (a missing or wrong confirmation, 428).',
    attributes: { outcome: { kind: 'enum', values: DESTRUCTIVE_RUN_OUTCOMES } },
  },
  {
    key: RUNBOOK_DRY_RUNS_METRIC,
    name: 'app.runbooks.dry_runs',
    kind: 'counter',
    unit: '{run}',
    description: 'Runbook dry runs launched.',
    attributes: {},
  },
  {
    key: RUNBOOK_ARTIFACT_BYTES_METRIC,
    name: 'app.runbooks.artifact_bytes',
    kind: 'histogram',
    unit: 'By',
    description: 'Size of a stored runbook artifact: a per-server log archive (target_archive) or a run bundle (bundle).',
    buckets: ARTIFACT_BYTES_BUCKETS,
    attributes: { kind: { kind: 'enum', values: ARTIFACT_KINDS } },
  },
  {
    key: RUNBOOK_BUNDLE_BUILDS_METRIC,
    name: 'app.runbooks.bundle_builds',
    kind: 'counter',
    unit: '{bundle}',
    description: 'Run bundle builds by outcome: built, empty (nothing to bundle) or failed.',
    attributes: { outcome: { kind: 'enum', values: BUNDLE_OUTCOMES } },
  },
];
