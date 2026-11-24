/**
 * The builder's model (issue #65): new steps with every default the schema would fill in, step
 * reordering, and the mapping of a `422 RUNBOOK_DEFINITION_INVALID` onto field errors.
 */
import { ApiError } from '../../../services/api';
import type { DefinitionIssue, RunbookDefinition, RunbookParameter, RunbookStep, RunbookStepKind } from '../api/types';
import { pathKey } from './format';

const RUN_AS = { sudo: false };

/** A fresh step of `kind`, its id unique among `existing`. */
export function newStep(kind: RunbookStepKind, existing: readonly RunbookStep[]): RunbookStep {
  const prefix = kind.replace(/_/g, '-');
  const taken = new Set(existing.map((s) => s.id));
  let n = 1;
  while (taken.has(`${prefix}-${n}`)) n += 1;
  const base = { id: `${prefix}-${n}`, when: 'on_success' as const, continueOnError: false, timeoutSec: 600 };
  switch (kind) {
    case 'command':
      return { ...base, kind, name: 'Run a command', command: '', runAs: RUN_AS, successExitCodes: [0] };
    case 'script':
      return { ...base, kind, name: 'Run a script', interpreter: 'bash', body: '', args: [], runAs: RUN_AS, successExitCodes: [0] };
    case 'package_update':
      return { ...base, kind, name: 'Update packages', manager: 'auto', packages: 'all', refreshIndex: true, securityOnly: false, runAs: { sudo: true } };
    case 'file_upload':
      return { ...base, kind, name: 'Upload a file', storageObjectId: '', destPath: '', mode: '0644', overwrite: false, runAs: RUN_AS };
    case 'collect_logs':
      return {
        ...base,
        kind,
        name: 'Collect logs',
        paths: [],
        journalUnits: [],
        maxBytesPerFile: 10 * 2 ** 20,
        maxTotalBytes: 100 * 2 ** 20,
        runAs: RUN_AS,
      };
    case 'ai_task':
      return {
        ...base,
        kind,
        name: 'AI task',
        goal: '',
        approvalMode: 'per_command',
        allow: [],
        deny: [],
        tools: ['run_command', 'read_file', 'list_dir'],
        maxSteps: 8,
        maxOutputTokens: 4000,
        commandTimeoutSec: 120,
        runAs: RUN_AS,
      };
    case 'approval_gate':
      return { ...base, kind, name: 'Wait for approval', scope: 'run', message: '', expiresAfterSec: 86_400 };
  }
}

export function newParameter(existing: readonly RunbookParameter[]): RunbookParameter {
  const taken = new Set(existing.map((p) => p.name));
  let n = 1;
  while (taken.has(`PARAM_${n}`)) n += 1;
  return { name: `PARAM_${n}`, type: 'string', required: false };
}

export function emptyDefinition(): RunbookDefinition {
  return {
    schemaVersion: 1,
    parameters: [],
    steps: [newStep('command', [])],
    defaultTargets: { serverIds: [], tags: { any: [], all: [] }, groupIds: [], exclude: [] },
    strategy: { concurrency: 5, maxFailures: { count: 0 }, abortInFlight: false, pauseAfterFirstBatch: false },
  };
}

/** Move the item at `from` by `delta` (clamped); the same array when it cannot move. */
export function move<T>(items: readonly T[], from: number, delta: number): T[] {
  const to = from + delta;
  if (to < 0 || to >= items.length || from < 0 || from >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/**
 * The field errors of a failed validate or save: `{ 'steps.0.command': message }`. The
 * definition's own issues come with paths into the definition; when a create wraps them under
 * `definition`, that segment is dropped. `null` when the error carries no issues.
 */
export function issuesToFieldErrors(error: unknown): Record<string, string> | null {
  if (!(error instanceof ApiError)) return null;
  const issues = (error.details as { issues?: DefinitionIssue[] } | undefined)?.issues;
  if (!Array.isArray(issues)) return null;
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path[0] === 'definition' ? issue.path.slice(1) : issue.path;
    const key = pathKey(path) || '_root';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Errors that belong to step `index` (any key under `steps.<index>`). */
export function stepErrorCount(errors: Record<string, string>, index: number): number {
  const prefix = `steps.${index}`;
  return Object.keys(errors).filter((k) => k === prefix || k.startsWith(`${prefix}.`)).length;
}
