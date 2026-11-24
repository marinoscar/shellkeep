/**
 * The runbooks wire types (issue #65).
 *
 * The DEFINITION types are the API's own (`import type` from the #61 schema module, erased at
 * build time, so no zod or RE2 code reaches the bundle) and the run events are the engine's
 * (#62). Never redeclare them here. The response envelopes below mirror the services that build
 * them (`runbooks.service.ts`, `engine/runbook-runs.service.ts`, `engine/runbook-approvals.service.ts`,
 * `engine/run-stream.service.ts`): those return plain objects, not exported schemas.
 */
import type {
  RunbookDefinition,
  RunbookDefinitionInput,
  RunbookParameter,
  RunbookStep,
  RunbookStepKind,
  RunStrategy,
  TargetSelector,
} from '../../../../../api/src/runbooks/schema/runbook-definition.schema';
import type { RunEvent } from '../../../../../api/src/runbooks/engine/run-events';

export type {
  RunbookDefinition,
  RunbookDefinitionInput,
  RunbookParameter,
  RunbookStep,
  RunbookStepKind,
  RunStrategy,
  TargetSelector,
  RunEvent,
};

/** Every step kind, in the builder's "Add step" order. Checked against the schema's union. */
export const STEP_KINDS = [
  'command',
  'script',
  'package_update',
  'file_upload',
  'collect_logs',
  'ai_task',
  'approval_gate',
] as const satisfies readonly RunbookStepKind[];

// A kind added to the schema but not to STEP_KINDS fails here.
type MissingKind = Exclude<RunbookStepKind, (typeof STEP_KINDS)[number]>;
const allKindsListed: MissingKind extends never ? true : never = true;
void allKindsListed;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RunbookOwner {
  kind: 'user' | 'group';
  id: string | null;
  name: string | null;
}

export interface RunbookAccess {
  role: string | null;
  via: string | null;
  shared: boolean;
  can: { run: boolean; write: boolean; share: boolean };
}

export interface RunbookVersionSummary {
  id: string;
  version: number;
  definitionSha256: string;
  changelog: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface RunbookVersionView extends RunbookVersionSummary {
  definition: RunbookDefinition;
  /** The destructive-command assessment of the definition (#67). */
  risk?: RunbookRisk;
}

export type RiskLevel = 'low' | 'medium' | 'high';

/** One step's finding (#67): the reasons, never the command text. */
export interface RiskFinding {
  stepId: string;
  stepIndex: number;
  kind: RunbookStepKind | string;
  risk: RiskLevel;
  destructive: boolean;
  reasons: string[];
  lines?: number[];
}

/** `risk` of the validate and read routes (#67). Saving is never blocked by it. */
export interface RunbookRisk {
  destructive: boolean;
  risk: RiskLevel;
  findings: RiskFinding[];
}

export interface RunbookView {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  ownerUserId: string | null;
  ownerGroupId: string | null;
  owner: RunbookOwner;
  access: RunbookAccess;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  latestVersion: RunbookVersionSummary | null;
}

export interface RunbookLastRun {
  id: string;
  status: RunStatus;
  createdAt: string;
  finishedAt: string | null;
}

/** A row of `GET /api/runbooks`. */
export interface RunbookListItem extends RunbookView {
  stepKinds: RunbookStepKind[];
  lastRun: RunbookLastRun | null;
}

/** `GET /api/runbooks/:id`: the latest version embedded. */
export interface RunbookDetail extends Omit<RunbookView, 'latestVersion'> {
  latestVersion: RunbookVersionView | null;
  /** The latest version's assessment (#67). */
  risk?: RunbookRisk;
}

export interface DefinitionWarning {
  code: string;
  path: (string | number)[];
  message: string;
}

/** One issue of a `422 RUNBOOK_DEFINITION_INVALID` or `RUNBOOK_PARAMS_INVALID`. */
export interface DefinitionIssue {
  path: (string | number)[];
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: true;
  definition: RunbookDefinition;
  definitionSha256: string;
  warnings: DefinitionWarning[];
  risk?: RunbookRisk;
}

export interface TargetPreviewServer {
  id: string;
  name: string;
  hostname: string;
  tags: string[];
  hostKeyTrusted: boolean;
  facts: { prettyName: string | null } | null;
}

export interface TargetPreview {
  servers: TargetPreviewServer[];
  skipped: { serverProfileId: string; reason: 'forbidden' | 'not_found' | string }[];
  total: number;
  capped: boolean;
  limit: number;
}

/** A runbook secret: its name and a masked hint, never the value. */
export interface RunbookSecret {
  name: string;
  label: string | null;
  hint: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

export const RUN_STATUSES = [
  'queued',
  'resolving',
  'running',
  'paused',
  'cancelling',
  'succeeded',
  'failed',
  'partially_failed',
  'aborted',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TARGET_STATUSES = ['pending', 'queued', 'running', 'waiting', 'succeeded', 'failed', 'skipped', 'cancelled'] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

export const STEP_STATUSES = [
  'pending',
  'running',
  'waiting_approval',
  'succeeded',
  'failed',
  'skipped',
  'timed_out',
  'cancelled',
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export type RunTrigger = 'manual' | 'api' | 'schedule';

/** The succeeded / failed / total split a run row carries (`failed` includes cancelled). */
export interface RunTargetCounts {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
}

/** A row of `GET /api/runbook-runs`. */
export interface RunListItem extends RunSummary {
  targets: RunTargetCounts;
}

/** A run's own fields, shared by the list row and the detail. */
export interface RunSummary {
  id: string;
  runbookId: string;
  runbookName: string;
  version: number;
  status: RunStatus;
  trigger: RunTrigger;
  initiatedBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** A dry run (#67): probes only, nothing changed. */
  dryRun?: boolean;
  /** The definition was destructive when it was launched (#67). */
  destructive?: boolean;
  /** `APPROVAL_REJECTED`, `APPROVAL_EXPIRED`, ... (#67). */
  errorCode?: string | null;
}

export interface RunStepRow {
  id: string;
  runTargetId: string;
  stepIndex: number;
  stepId: string;
  kind: RunbookStepKind;
  name: string;
  status: StepStatus;
  exitCode: number | null;
  durationMs: number | null;
  errorCode: string | null;
  logBytes: number;
  logTruncated: boolean;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunTargetRow {
  id: string;
  runId: string;
  serverProfileId: string | null;
  position: number;
  batchIndex: number;
  status: TargetStatus;
  serverName: string;
  hostname: string;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  steps: RunStepRow[];
}

/** `GET /api/runbook-runs/:id`. `params` are the non-secret values; `secretRefs` names only. */
export interface RunDetail extends RunSummary {
  retryOfRunId: string | null;
  params: Record<string, string | number | boolean>;
  secretRefs: Record<string, string>;
  strategy: Partial<RunStrategy>;
  cancelRequestedAt: string | null;
  counts: { total: number } & Partial<Record<TargetStatus, number>>;
  targets: RunTargetRow[];
  /** The run's approvals (#67), a pending `destructive_run` among them while it waits. */
  approvals?: RunbookApproval[];
}

/** The first frame of a run stream. */
export interface RunSnapshot {
  run: { id: string; status: RunStatus; finishedAt: string | null };
  targets: { id: string; status: TargetStatus; errorCode: string | null }[];
  steps: {
    id: string;
    runTargetId: string;
    stepIndex: number;
    status: StepStatus;
    exitCode: number | null;
    durationMs: number | null;
  }[];
}

export type RunChunkEvent = Extract<RunEvent, { type: 'chunk' }>;

/** `POST /api/runbooks/:id/runs`. */
export interface CreateRunInput {
  version?: number;
  params: Record<string, string | number | boolean>;
  secretRefs?: Record<string, string>;
  targets?: Partial<TargetSelector>;
  strategy?: Partial<RunStrategy>;
  /** Probes only (#67): no confirmation, no approval, nothing changed. */
  dryRun?: boolean;
  /** A destructive runbook's confirmation (#67): the exact name and the resolved server count. */
  confirm?: { runbookName: string; targetCount: number };
}

/** `202` of a run start. */
export interface StartRunResult {
  runId: string;
  status?: string;
  dryRun?: boolean;
  /** The two-person rule held the run until someone else approves it (#67). */
  awaitingApproval?: boolean;
  approvalId?: string | null;
}

/** `details` of `428 RUNBOOK_CONFIRMATION_REQUIRED` (#67). */
export interface ConfirmationRequired {
  runbookName: string;
  targetCount: number;
  requiresApproval: boolean;
  findings: RiskFinding[];
}

/** One row of a run's audit trail (#67). */
export interface RunAuditItem {
  at: string;
  kind: 'event' | 'command';
  event: string | null;
  userId: string | null;
  approverUserId: string | null;
  serverProfileId: string | null;
  serverName: string | null;
  stepIndex: number | null;
  stepName: string | null;
  origin: string | null;
  commandPreview: string | null;
  commandSha256: string | null;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean | null;
  durationMs: number | null;
  outcome: string | null;
  detail: string | null;
  dryRun: boolean | null;
}

export interface RunAuditPage extends Page<RunAuditItem> {
  events: number;
  commands: number;
}

/** A row of the org-wide command log `GET /api/runbook-commands` (#67). */
export interface RunbookCommandRow extends RunAuditItem {
  id: string;
  runId: string;
  runbookId: string;
  runbookName: string;
}

export type ApprovalKind = 'gate' | 'ai_command' | 'ai_plan' | 'destructive_run' | (string & {});
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

/** A row of `GET /api/runbook-approvals`. */
export interface RunbookApproval {
  id: string;
  runId: string;
  runTargetId: string | null;
  scope: 'run' | 'target' | string;
  kind: ApprovalKind;
  stepIndex: number;
  stepName: string;
  /** Redacted by the engine before it is stored (a command or plan of an AI step, #64). */
  message: string;
  status: ApprovalStatus;
  expiresAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
  createdAt: string;
  runbookName: string | null;
  runbookVersion: number;
  initiatedBy: string | null;
  initiatedByName: string | null;
  targetName: string | null;
}

export interface ApprovalsPage extends Page<RunbookApproval> {
  allowSelfApproval: boolean;
}
