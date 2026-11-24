import type { JobReasonDefinition, RetentionPolicyDefinition } from '@marinoscar/platform-api/jobs';
import type { NodeSpanAttributeDefinition } from '@marinoscar/platform-api/nodes';

// =============================================================================
// This app's jobs and nodes registrations (issue #49)
// =============================================================================
//
// Pure data, empty to start: the consumers register them AT IMPORT TIME, before
// the application bootstraps (the registries freeze after that).
//
//   APP_JOB_REASONS           extra `jobs.reason` ids (`registerJobReason`),
//                             registered by `platform/jobs/jobs.config.ts`.
//   APP_RETENTION_POLICIES    extra tables in the nightly retention
//                             (`registerRetentionPolicy`), registered by
//                             `platform/settings/registry.ts` BEFORE the
//                             `retention` namespace is composed.
//   APP_NODE_SPAN_ATTRIBUTES  attributes a node's executor spans may carry
//                             (`registerNodeSpanAttribute`), registered by
//                             `platform/jobs/jobs.config.ts`.
//
// A job TYPE needs no registration here: a live handler declares its own
// `label` (see `terminal/jobs/session-reap.handler.ts`).
// =============================================================================

/** This app's own job reasons. */
export const APP_JOB_REASONS: readonly JobReasonDefinition[] = [
  // The runbook engine's run, target, advance and reconcile jobs (#62).
  { id: 'runbook_run', label: 'Runbook run' },
];

/** This app's own retention policies. */
export const APP_RETENTION_POLICIES: readonly RetentionPolicyDefinition[] = [];

/** This app's own relayed node span attributes. */
export const APP_NODE_SPAN_ATTRIBUTES: readonly NodeSpanAttributeDefinition[] = [];
