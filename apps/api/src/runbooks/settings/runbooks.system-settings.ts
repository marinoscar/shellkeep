// =============================================================================
// The `runbooks` system-settings namespace (issue #61)
// =============================================================================
//
// The `runbooks` key of the `global` row of `system_settings`, with an ORG LAYER an
// organization may only TIGHTEN (it can switch a capability off or lower a limit, never
// switch one on or raise a limit past the deployment's value).
//
//   enabled                       master switch for the runbooks feature
//   maxTargetsPerRun              servers one run may target (the target resolver's cap)
//   maxConcurrency                servers a run may work on at once
//   defaultStepTimeoutSec         timeout of a step that states none
//   maxLogBytesPerStep            output kept per step
//   approvals.allowSelfApproval   whether the person who started a run may approve it
//   approvals.defaultExpirySec    how long an approval request stays open
//   ai.agentEnabled               whether `ai_task` steps may run
//
// No secret lives in this namespace.
// =============================================================================

import { z } from 'zod';
import type { SystemSettingsNamespace } from '@marinoscar/platform-api/settings';

export const RUNBOOKS_SYSTEM_SETTINGS_KEY = 'runbooks';

export const RUNBOOKS_BOUNDS = {
  maxTargetsPerRun: { min: 1, max: 2000 },
  maxConcurrency: { min: 1, max: 50 },
  defaultStepTimeoutSec: { min: 1, max: 14_400 },
  maxLogBytesPerStep: { min: 1024, max: 50 * 2 ** 20 },
  defaultExpirySec: { min: 60, max: 7 * 86_400 },
} as const;

const bounded = (b: { min: number; max: number }) => z.number().int().min(b.min).max(b.max);

export interface RunbooksSystemSettings {
  enabled: boolean;
  maxTargetsPerRun: number;
  maxConcurrency: number;
  defaultStepTimeoutSec: number;
  maxLogBytesPerStep: number;
  approvals: { allowSelfApproval: boolean; defaultExpirySec: number };
  ai: { agentEnabled: boolean };
}

export type RunbooksSystemSettingsPatch = {
  enabled?: boolean;
  maxTargetsPerRun?: number;
  maxConcurrency?: number;
  defaultStepTimeoutSec?: number;
  maxLogBytesPerStep?: number;
  approvals?: Partial<RunbooksSystemSettings['approvals']>;
  ai?: Partial<RunbooksSystemSettings['ai']>;
};

export const DEFAULT_RUNBOOKS_SYSTEM_SETTINGS: RunbooksSystemSettings = {
  enabled: true,
  maxTargetsPerRun: 200,
  maxConcurrency: 20,
  defaultStepTimeoutSec: 600,
  maxLogBytesPerStep: 5 * 2 ** 20,
  approvals: { allowSelfApproval: false, defaultExpirySec: 86_400 },
  ai: { agentEnabled: true },
};

export const runbooksSystemSettingsSchema = z.object({
  enabled: z.boolean(),
  maxTargetsPerRun: bounded(RUNBOOKS_BOUNDS.maxTargetsPerRun),
  maxConcurrency: bounded(RUNBOOKS_BOUNDS.maxConcurrency),
  defaultStepTimeoutSec: bounded(RUNBOOKS_BOUNDS.defaultStepTimeoutSec),
  maxLogBytesPerStep: bounded(RUNBOOKS_BOUNDS.maxLogBytesPerStep),
  approvals: z.object({
    allowSelfApproval: z.boolean(),
    defaultExpirySec: bounded(RUNBOOKS_BOUNDS.defaultExpirySec),
  }),
  ai: z.object({ agentEnabled: z.boolean() }),
});

export const runbooksSystemSettingsPatchSchema = z.object({
  enabled: runbooksSystemSettingsSchema.shape.enabled.optional(),
  maxTargetsPerRun: runbooksSystemSettingsSchema.shape.maxTargetsPerRun.optional(),
  maxConcurrency: runbooksSystemSettingsSchema.shape.maxConcurrency.optional(),
  defaultStepTimeoutSec: runbooksSystemSettingsSchema.shape.defaultStepTimeoutSec.optional(),
  maxLogBytesPerStep: runbooksSystemSettingsSchema.shape.maxLogBytesPerStep.optional(),
  approvals: runbooksSystemSettingsSchema.shape.approvals.partial().optional(),
  ai: runbooksSystemSettingsSchema.shape.ai.partial().optional(),
});

/** What an organization may store: every field optional, the same bounds. */
export const orgRunbooksSettingsSchema = runbooksSystemSettingsPatchSchema;

/** Reads a stored value field by field: a missing or invalid field reads as its default. */
function salvage(stored: unknown): RunbooksSystemSettings {
  const d = DEFAULT_RUNBOOKS_SYSTEM_SETTINGS;
  const obj = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const s = obj(stored);
  const field = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : fallback;
  };
  const shape = runbooksSystemSettingsSchema.shape;
  const approvals = obj(s.approvals);
  const ai = obj(s.ai);
  return {
    enabled: field(shape.enabled, s.enabled, d.enabled),
    maxTargetsPerRun: field(shape.maxTargetsPerRun, s.maxTargetsPerRun, d.maxTargetsPerRun),
    maxConcurrency: field(shape.maxConcurrency, s.maxConcurrency, d.maxConcurrency),
    defaultStepTimeoutSec: field(shape.defaultStepTimeoutSec, s.defaultStepTimeoutSec, d.defaultStepTimeoutSec),
    maxLogBytesPerStep: field(shape.maxLogBytesPerStep, s.maxLogBytesPerStep, d.maxLogBytesPerStep),
    approvals: {
      allowSelfApproval: field(shape.approvals.shape.allowSelfApproval, approvals.allowSelfApproval, d.approvals.allowSelfApproval),
      defaultExpirySec: field(shape.approvals.shape.defaultExpirySec, approvals.defaultExpirySec, d.approvals.defaultExpirySec),
    },
    ai: { agentEnabled: field(shape.ai.shape.agentEnabled, ai.agentEnabled, d.ai.agentEnabled) },
  };
}

/**
 * The org layer's merge: an organization can only RESTRICT. A switch is the AND of the two
 * values, a limit is the smaller of the two.
 */
export function tightenRunbooksSettings(system: RunbooksSystemSettings, org: RunbooksSystemSettingsPatch): RunbooksSystemSettings {
  const min = (a: number, b: number | undefined) => (b === undefined ? a : Math.min(a, b));
  const and = (a: boolean, b: boolean | undefined) => (b === undefined ? a : a && b);
  return {
    enabled: and(system.enabled, org.enabled),
    maxTargetsPerRun: min(system.maxTargetsPerRun, org.maxTargetsPerRun),
    maxConcurrency: min(system.maxConcurrency, org.maxConcurrency),
    defaultStepTimeoutSec: min(system.defaultStepTimeoutSec, org.defaultStepTimeoutSec),
    maxLogBytesPerStep: min(system.maxLogBytesPerStep, org.maxLogBytesPerStep),
    approvals: {
      allowSelfApproval: and(system.approvals.allowSelfApproval, org.approvals?.allowSelfApproval),
      defaultExpirySec: min(system.approvals.defaultExpirySec, org.approvals?.defaultExpirySec),
    },
    ai: { agentEnabled: and(system.ai.agentEnabled, org.ai?.agentEnabled) },
  };
}

export const RUNBOOKS_SYSTEM_SETTINGS: SystemSettingsNamespace<
  typeof RUNBOOKS_SYSTEM_SETTINGS_KEY,
  RunbooksSystemSettings,
  RunbooksSystemSettingsPatch
> = {
  key: RUNBOOKS_SYSTEM_SETTINGS_KEY,
  description:
    'Runbooks: the feature switch, per-run target and concurrency limits, step defaults, approval rules and the AI agent switch. Organizations may only tighten these.',
  storedSchema: runbooksSystemSettingsSchema,
  patchSchema: runbooksSystemSettingsPatchSchema,
  putSchema: runbooksSystemSettingsSchema,
  wirePatchSchema: runbooksSystemSettingsPatchSchema,
  responseSchema: runbooksSystemSettingsSchema,
  defaults: DEFAULT_RUNBOOKS_SYSTEM_SETTINGS,
  // A PUT that omits the namespace keeps the stored value, as every optional namespace does.
  requiredOnPut: false,
  read: (stored) => salvage(stored),
  merge: (current, patch) => ({
    enabled: patch?.enabled ?? current.enabled,
    maxTargetsPerRun: patch?.maxTargetsPerRun ?? current.maxTargetsPerRun,
    maxConcurrency: patch?.maxConcurrency ?? current.maxConcurrency,
    defaultStepTimeoutSec: patch?.defaultStepTimeoutSec ?? current.defaultStepTimeoutSec,
    maxLogBytesPerStep: patch?.maxLogBytesPerStep ?? current.maxLogBytesPerStep,
    approvals: { ...current.approvals, ...stripUndefined(patch?.approvals) },
    ai: { ...current.ai, ...stripUndefined(patch?.ai) },
  }),
  org: {
    schema: orgRunbooksSettingsSchema,
    merge: (system, org) => tightenRunbooksSettings(system, org as RunbooksSystemSettingsPatch),
    mode: 'tighten',
    readPermission: 'org_settings:read',
    writePermission: 'org_settings:write',
  },
};

function stripUndefined<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

declare module '@marinoscar/platform-api/settings' {
  interface SystemSettingsNamespaces {
    runbooks: RunbooksSystemSettings;
  }

  interface SystemSettingsNamespaceDeclarations {
    runbooks: typeof RUNBOOKS_SYSTEM_SETTINGS;
  }
}
