// =============================================================================
// The runbook definition schema (issue #61)
// =============================================================================
//
// A runbook VERSION stores one `RunbookDefinition` as JSON. This file is the single
// source of its shape: the API validates every write with `runbookDefinitionSchema`
// and the web imports the inferred types (`import type`, no runtime cost).
//
// PARAMETERS REACH A COMMAND ONLY AS ENVIRONMENT VARIABLES. There is NO template
// substitution into command text, script bodies or paths: `${NAME}` in a `command`
// is the shell's own expansion of an exported variable, never ours. That rules out
// injection through a parameter value. A `secret` parameter has no value in the
// definition at all; a run names the credential that fills it (`secretRefs`).
//
// RE2: every `allow`, `deny` and parameter `pattern` is compiled with RE2
// (`re2-pattern.ts`): linear time, no look-around, no back-references.
//
// A step sequence is cut into SEGMENTS by its pause points (`approval_gate` and
// `ai_task`, which hand control back to a person or a model). The steps of one
// segment run inside one `runbook.target.run` job, so their summed `timeoutSec`
// must fit its 4-hour `maxRuntimeMs` (`MAX_SEGMENT_TIMEOUT_SEC`).
//
// Pure: no Nest, no Prisma. The only runtime dependencies are zod and re2.
// =============================================================================

import { z } from 'zod';

import { re2CompileError } from './re2-pattern';

/** The `maxRuntimeMs` of `runbook.target.run`, in seconds: the budget of one segment. */
export const MAX_SEGMENT_TIMEOUT_SEC = 14_400;

const stepId = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/, 'Step id: lower-case letters, digits, "_" or "-", starting with a letter (max 48)');

const runAs = z
  .object({
    sudo: z.boolean().default(false),
    user: z
      .string()
      .regex(/^[a-z_][a-z0-9_-]{0,31}$/, 'Not a valid unix user name')
      .optional(),
  })
  .prefault({});

const absPath = z
  .string()
  .max(1024)
  .regex(/^\/[^\0]*$/, 'Must be an absolute path without NUL bytes')
  .refine((p) => !p.split('/').includes('..'), { message: 'Path must not contain ".." segments' });

/** A pattern compiled with RE2 by {@link checkDefinition}. */
const re2Pattern = z.string().min(1).max(200);

const base = {
  id: stepId,
  name: z.string().min(1).max(120),
  when: z.enum(['on_success', 'on_failure', 'always']).default('on_success'),
  continueOnError: z.boolean().default(false),
  timeoutSec: z.number().int().min(1).max(MAX_SEGMENT_TIMEOUT_SEC).default(600),
};

const exitCodes = z.array(z.number().int().min(0).max(255)).min(1).max(16).default([0]);

export const RUNBOOK_STEP_KINDS = [
  'command',
  'script',
  'package_update',
  'file_upload',
  'collect_logs',
  'ai_task',
  'approval_gate',
] as const;

export const runbookStepSchema = z.discriminatedUnion('kind', [
  z.object({
    ...base,
    kind: z.literal('command'),
    command: z.string().min(1).max(8192),
    workdir: absPath.optional(),
    runAs,
    successExitCodes: exitCodes,
  }),
  z.object({
    ...base,
    kind: z.literal('script'),
    interpreter: z.enum(['bash', 'sh', 'python3']).default('bash'),
    body: z.string().min(1).max(65_536),
    args: z.array(z.string().max(1024)).max(32).default([]),
    workdir: absPath.optional(),
    runAs,
    successExitCodes: exitCodes,
  }),
  z.object({
    ...base,
    kind: z.literal('package_update'),
    manager: z.enum(['auto', 'apt', 'dnf', 'yum', 'apk', 'zypper', 'brew']).default('auto'),
    packages: z.union([
      z.literal('all'),
      z
        .array(z.string().regex(/^[A-Za-z0-9.+_:@=~-]{1,128}$/, 'Not a valid package name'))
        .min(1)
        .max(100),
    ]),
    refreshIndex: z.boolean().default(true),
    securityOnly: z.boolean().default(false),
    runAs,
  }),
  z.object({
    ...base,
    kind: z.literal('file_upload'),
    storageObjectId: z.string().uuid(),
    destPath: absPath,
    mode: z.string().regex(/^0?[0-7]{3,4}$/, 'Octal file mode such as 0644').default('0644'),
    owner: z
      .string()
      .regex(/^[a-z_][a-z0-9_-]{0,31}(:[a-z_][a-z0-9_-]{0,31})?$/, 'Use user or user:group')
      .optional(),
    overwrite: z.boolean().default(false),
    runAs,
  }),
  z.object({
    ...base,
    kind: z.literal('collect_logs'),
    // A path or glob travels as ONE line of an environment variable: no line break or other control character.
    paths: z
      .array(absPath.refine((p) => !/[\u0000-\u001f\u007f]/.test(p), { message: 'Path must not contain control characters' }))
      .max(50)
      .default([]),
    journalUnits: z
      .array(z.string().regex(/^[A-Za-z0-9@._-]{1,128}$/, 'Not a valid systemd unit name'))
      .max(20)
      .default([]),
    since: z.string().regex(/^\d{1,4}[mhd]$/, 'Use a number and m, h or d (for example 24h)').optional(),
    maxBytesPerFile: z.number().int().min(1024).max(50 * 2 ** 20).default(10 * 2 ** 20),
    maxTotalBytes: z.number().int().min(1024).max(500 * 2 ** 20).default(100 * 2 ** 20),
    /** A step that matched no file fails (default: it succeeds with `file_count` 0). Additive: `schemaVersion` stays 1. */
    failIfEmpty: z.boolean().default(false),
    runAs,
  }),
  z.object({
    ...base,
    kind: z.literal('ai_task'),
    goal: z.string().min(1).max(4000),
    approvalMode: z.enum(['per_command', 'plan', 'autonomous_within_allowlist']),
    allow: z.array(re2Pattern).max(50).default([]),
    deny: z.array(re2Pattern).max(50).default([]),
    tools: z
      .array(z.enum(['run_command', 'read_file', 'list_dir']))
      .min(1)
      .default(['run_command', 'read_file', 'list_dir']),
    maxSteps: z.number().int().min(1).max(20).default(8),
    maxOutputTokens: z.number().int().min(256).max(32_000).default(4000),
    commandTimeoutSec: z.number().int().min(1).max(3600).default(120),
    runAs,
  }),
  z.object({
    ...base,
    kind: z.literal('approval_gate'),
    scope: z.enum(['run', 'target']).default('run'),
    message: z.string().max(2000).default(''),
    expiresAfterSec: z.number().int().min(60).max(7 * 86_400).default(86_400),
  }),
]);

export const runbookParameterSchema = z.object({
  name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/, 'Parameter name: UPPER_SNAKE_CASE, starting with a letter (max 64)'),
  label: z.string().max(120).optional(),
  description: z.string().max(500).optional(),
  type: z.enum(['string', 'number', 'boolean', 'enum', 'secret']),
  required: z.boolean().default(false),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.string()).max(50).optional(),
  /** An RE2 expression a `string` value must match (unanchored: anchor it with `^` and `$`). */
  pattern: re2Pattern.optional(),
});

export const targetSelectorSchema = z.object({
  serverIds: z.array(z.string().uuid()).max(500).default([]),
  tags: z
    .object({
      any: z.array(z.string()).max(20).default([]),
      all: z.array(z.string()).max(20).default([]),
    })
    .prefault({}),
  groupIds: z.array(z.string().uuid()).max(20).default([]),
  exclude: z.array(z.string().uuid()).max(500).default([]),
});

export const runStrategySchema = z.object({
  concurrency: z.number().int().min(1).max(50).default(5),
  /** Rolling waves of this size; absent means a sliding window of `concurrency`. */
  batchSize: z.number().int().min(1).max(500).optional(),
  /** `{ count: 0 }` is fail-fast. */
  maxFailures: z
    .union([z.object({ count: z.number().int().min(0) }), z.object({ percent: z.number().min(0).max(100) })])
    .default({ count: 0 }),
  abortInFlight: z.boolean().default(false),
  /** Canary: pause the run after the first batch. */
  pauseAfterFirstBatch: z.boolean().default(false),
});

/** The input shape of a definition (before defaults are applied and cross-field rules run). */
const runbookDefinitionObject = z.object({
  schemaVersion: z.literal(1),
  parameters: z.array(runbookParameterSchema).max(30).default([]),
  steps: z.array(runbookStepSchema).min(1).max(50),
  defaultTargets: targetSelectorSchema.prefault({}),
  strategy: runStrategySchema.prefault({}),
});

type DefinitionDraft = z.output<typeof runbookDefinitionObject>;

/** The pause points that cut a step sequence into segments. */
const PAUSE_KINDS: ReadonlySet<string> = new Set(['approval_gate', 'ai_task']);

/**
 * The cross-field rules of a definition. Each failure is a `custom` issue at the path of the
 * offending field, so a client can point at it.
 */
export function checkDefinition(definition: DefinitionDraft, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string): void => {
    ctx.addIssue({ code: 'custom', path, message });
  };

  // Unique parameter names, and per-parameter rules.
  const names = new Set<string>();
  definition.parameters.forEach((param, index) => {
    if (names.has(param.name)) issue(['parameters', index, 'name'], `Duplicate parameter name "${param.name}"`);
    names.add(param.name);

    if (param.type === 'enum' && (!param.options || param.options.length === 0)) {
      issue(['parameters', index, 'options'], 'An enum parameter needs at least one option');
    }
    if (param.type !== 'enum' && param.options !== undefined) {
      issue(['parameters', index, 'options'], 'Only an enum parameter has options');
    }
    if (param.type === 'secret' && param.default !== undefined) {
      issue(['parameters', index, 'default'], 'A secret parameter must not have a default: a secret never lives in a definition');
    }
    if (param.type !== 'string' && param.pattern !== undefined) {
      issue(['parameters', index, 'pattern'], 'Only a string parameter has a pattern');
    }
    if (param.pattern !== undefined) {
      const error = re2CompileError(param.pattern);
      if (error) issue(['parameters', index, 'pattern'], `Not a valid RE2 pattern: ${error}`);
    }
    if (param.default !== undefined && param.type !== 'secret') {
      const expected = param.type === 'enum' ? 'string' : param.type;
      if (typeof param.default !== expected) {
        issue(['parameters', index, 'default'], `The default of a ${param.type} parameter must be a ${expected}`);
      } else if (param.type === 'enum' && !(param.options ?? []).includes(param.default as string)) {
        issue(['parameters', index, 'default'], 'The default must be one of the options');
      }
    }
  });

  // Unique step ids, per-kind rules, and the segment time budget.
  const ids = new Set<string>();
  let segmentSec = 0;
  let segmentReported = false;
  definition.steps.forEach((step, index) => {
    if (ids.has(step.id)) issue(['steps', index, 'id'], `Duplicate step id "${step.id}"`);
    ids.add(step.id);

    if (step.kind === 'ai_task') {
      if (step.approvalMode === 'autonomous_within_allowlist' && step.allow.length === 0) {
        issue(['steps', index, 'allow'], 'Autonomous mode needs at least one allow pattern');
      }
      (['allow', 'deny'] as const).forEach((list) => {
        step[list].forEach((pattern, patternIndex) => {
          const error = re2CompileError(pattern);
          if (error) issue(['steps', index, list, patternIndex], `Not a valid RE2 pattern: ${error}`);
        });
      });
    }
    if (step.kind === 'collect_logs' && step.paths.length === 0 && step.journalUnits.length === 0) {
      issue(['steps', index, 'paths'], 'collect_logs needs at least one path or journal unit');
    }

    if (PAUSE_KINDS.has(step.kind)) {
      segmentSec = 0;
      segmentReported = false;
      return;
    }
    segmentSec += step.timeoutSec;
    if (segmentSec > MAX_SEGMENT_TIMEOUT_SEC && !segmentReported) {
      segmentReported = true;
      issue(
        ['steps', index, 'timeoutSec'],
        `The steps between two pause points (approval gate or AI task) may total at most ${MAX_SEGMENT_TIMEOUT_SEC} seconds; this segment reaches ${segmentSec}`,
      );
    }
  });
}

/**
 * A runbook definition: the parameters it takes, the steps it runs, the servers it targets by
 * default and how a run spreads over them. `parse` returns the NORMALISED definition (every default
 * filled in), which is what is hashed and stored.
 */
export const runbookDefinitionSchema = runbookDefinitionObject.superRefine(checkDefinition);

export type RunbookStep = z.output<typeof runbookStepSchema>;
export type RunbookStepKind = RunbookStep['kind'];
export type RunbookParameter = z.output<typeof runbookParameterSchema>;
export type TargetSelector = z.output<typeof targetSelectorSchema>;
export type RunStrategy = z.output<typeof runStrategySchema>;
export type RunbookDefinition = z.output<typeof runbookDefinitionSchema>;
export type RunbookDefinitionInput = z.input<typeof runbookDefinitionSchema>;
