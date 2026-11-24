/**
 * The runbook definition and run-event wire types (issue #65), as the web sees them.
 *
 * The web never imports API source: the production image builds `apps/web` alone, and the UI
 * presents what the API sends. These mirror the API's shapes, which it owns and validates:
 *   - the definition: `apps/api/src/runbooks/schema/runbook-definition.schema.ts` (#61), the
 *     OUTPUT (normalised) form, every default filled in, which is what the reads return;
 *   - the run events: `apps/api/src/runbooks/engine/run-events.ts` (#62).
 * A change there is a change here; `__tests__/architecture/web-api-boundary.test.ts` keeps the
 * web from reaching for the API's files instead.
 */

export type RunbookStepKind =
  | 'command'
  | 'script'
  | 'package_update'
  | 'file_upload'
  | 'collect_logs'
  | 'ai_task'
  | 'approval_gate';

export interface RunAs {
  sudo: boolean;
  user?: string;
}

interface StepBase {
  id: string;
  name: string;
  when: 'on_success' | 'on_failure' | 'always';
  continueOnError: boolean;
  timeoutSec: number;
}

export interface CommandStep extends StepBase {
  kind: 'command';
  command: string;
  workdir?: string;
  runAs: RunAs;
  successExitCodes: number[];
}

export interface ScriptStep extends StepBase {
  kind: 'script';
  interpreter: 'bash' | 'sh' | 'python3';
  body: string;
  args: string[];
  workdir?: string;
  runAs: RunAs;
  successExitCodes: number[];
}

export interface PackageUpdateStep extends StepBase {
  kind: 'package_update';
  manager: 'auto' | 'apt' | 'dnf' | 'yum' | 'apk' | 'zypper' | 'brew';
  packages: 'all' | string[];
  refreshIndex: boolean;
  securityOnly: boolean;
  runAs: RunAs;
}

export interface FileUploadStep extends StepBase {
  kind: 'file_upload';
  storageObjectId: string;
  destPath: string;
  mode: string;
  owner?: string;
  overwrite: boolean;
  runAs: RunAs;
}

export interface CollectLogsStep extends StepBase {
  kind: 'collect_logs';
  paths: string[];
  journalUnits: string[];
  since?: string;
  maxBytesPerFile: number;
  maxTotalBytes: number;
  runAs: RunAs;
}

export interface AiTaskStep extends StepBase {
  kind: 'ai_task';
  goal: string;
  approvalMode: 'per_command' | 'plan' | 'autonomous_within_allowlist';
  allow: string[];
  deny: string[];
  tools: ('run_command' | 'read_file' | 'list_dir')[];
  maxSteps: number;
  maxOutputTokens: number;
  commandTimeoutSec: number;
  runAs: RunAs;
}

export interface ApprovalGateStep extends StepBase {
  kind: 'approval_gate';
  scope: 'run' | 'target';
  message: string;
  expiresAfterSec: number;
}

export type RunbookStep =
  | CommandStep
  | ScriptStep
  | PackageUpdateStep
  | FileUploadStep
  | CollectLogsStep
  | AiTaskStep
  | ApprovalGateStep;

export interface RunbookParameter {
  name: string;
  label?: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'secret';
  required: boolean;
  default?: string | number | boolean;
  options?: string[];
  /** An RE2 expression a `string` value must match. */
  pattern?: string;
}

export interface TargetSelector {
  serverIds: string[];
  tags: { any: string[]; all: string[] };
  groupIds: string[];
  exclude: string[];
}

export interface RunStrategy {
  concurrency: number;
  batchSize?: number;
  maxFailures: { count: number } | { percent: number };
  abortInFlight: boolean;
  pauseAfterFirstBatch: boolean;
}

export interface RunbookDefinition {
  schemaVersion: 1;
  parameters: RunbookParameter[];
  steps: RunbookStep[];
  defaultTargets: TargetSelector;
  strategy: RunStrategy;
}

/** What the web sends: the API fills in any default the builder left out. */
export type RunbookDefinitionInput = RunbookDefinition;

/** A live run event (the SSE `run`, `target`, `step`, `approval` and `chunk` frames). */
export type RunEvent =
  | { type: 'run'; runId: string; status: string; finishedAt?: string | null }
  | { type: 'target'; runId: string; targetId: string; status: string; errorCode?: string | null }
  | {
      type: 'step';
      runId: string;
      targetId: string;
      stepIndex: number;
      status: string;
      exitCode?: number | null;
      durationMs?: number | null;
    }
  | { type: 'approval'; runId: string; approvalId: string; status: string; scope: string; kind: string }
  | {
      type: 'chunk';
      runId: string;
      targetId: string;
      stepIndex: number;
      /** The step row id: with `seq` it is the SSE event id (`<stepRowId>:<seq>`). */
      stepRowId: string;
      seq: number;
      stream: 'stdout' | 'stderr' | 'system';
      data: string;
    };
