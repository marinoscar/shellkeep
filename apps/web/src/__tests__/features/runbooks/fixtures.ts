/** Invented runbook fixtures (issue #65). No real hosts, people or companies. */
import type {
  RunbookApproval,
  RunbookDefinition,
  RunbookDetail,
  RunbookListItem,
  RunDetail,
  RunStepRow,
  RunTargetRow,
} from '../../../features/runbooks/api/types';
import { mockUser, type MockUser } from '../../utils/test-utils';

export const RUNBOOK_ID = '11111111-1111-4111-8111-111111111111';
export const RUN_ID = '22222222-2222-4222-8222-222222222222';

export const runbookUser = (permissions: string[]): MockUser => ({
  ...mockUser,
  permissions: [...mockUser.permissions, ...permissions],
});

export function makeDefinition(over: Partial<RunbookDefinition> = {}): RunbookDefinition {
  return {
    schemaVersion: 1,
    parameters: [],
    steps: [
      {
        id: 'disk',
        name: 'Check disk',
        kind: 'command',
        command: 'df -h',
        when: 'on_success',
        continueOnError: false,
        timeoutSec: 600,
        runAs: { sudo: false },
        successExitCodes: [0],
      },
    ],
    defaultTargets: { serverIds: [], tags: { any: ['web'], all: [] }, groupIds: [], exclude: [] },
    strategy: { concurrency: 5, maxFailures: { count: 0 }, abortInFlight: false, pauseAfterFirstBatch: false },
    ...over,
  } as RunbookDefinition;
}

export function makeListItem(over: Partial<RunbookListItem> = {}): RunbookListItem {
  return {
    id: RUNBOOK_ID,
    name: 'Patch web tier',
    description: 'Updates packages',
    tags: ['web', 'patching'],
    ownerUserId: mockUser.id,
    ownerGroupId: null,
    owner: { kind: 'user', id: mockUser.id, name: 'Test User' },
    access: { role: 'owner', via: 'owner', shared: false, can: { run: true, write: true, share: true } },
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    latestVersion: { id: 'v3', version: 3, definitionSha256: 'a'.repeat(64), changelog: null, createdBy: null, createdAt: '2026-01-01T00:00:00.000Z' },
    stepKinds: ['command', 'package_update'],
    lastRun: { id: RUN_ID, status: 'failed', createdAt: new Date(Date.now() - 3_600_000).toISOString(), finishedAt: null },
    ...over,
  };
}

export function makeDetail(over: Partial<RunbookDetail> = {}, definition: RunbookDefinition = makeDefinition()): RunbookDetail {
  const item = makeListItem();
  return {
    ...item,
    latestVersion: { ...item.latestVersion!, definition },
    ...over,
  } as RunbookDetail;
}

export function makeStep(targetId: string, stepIndex: number, over: Partial<RunStepRow> = {}): RunStepRow {
  return {
    id: `${targetId.slice(0, 8)}-0000-4000-8000-${String(stepIndex).padStart(12, '0')}`,
    runTargetId: targetId,
    stepIndex,
    stepId: `s${stepIndex}`,
    kind: 'command',
    name: `Step ${stepIndex + 1}`,
    status: 'pending',
    exitCode: null,
    durationMs: null,
    errorCode: null,
    logBytes: 0,
    logTruncated: false,
    startedAt: null,
    finishedAt: null,
    ...over,
  };
}

export function makeTarget(index: number, stepCount = 2, over: Partial<RunTargetRow> = {}): RunTargetRow {
  const id = `${String(index).padStart(8, '0')}-3333-4333-8333-333333333333`;
  return {
    id,
    runId: RUN_ID,
    serverProfileId: `${String(index).padStart(8, '0')}-4444-4444-8444-444444444444`,
    position: index,
    batchIndex: 0,
    status: 'pending',
    serverName: `server-${String(index).padStart(3, '0')}`,
    hostname: `server-${index}.example.test`,
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    steps: Array.from({ length: stepCount }, (_, s) => makeStep(id, s)),
    ...over,
  };
}

export function makeRun(targets: RunTargetRow[] = [makeTarget(0), makeTarget(1)], over: Partial<RunDetail> = {}): RunDetail {
  return {
    id: RUN_ID,
    runbookId: RUNBOOK_ID,
    runbookName: 'Patch web tier',
    version: 3,
    status: 'running',
    trigger: 'manual',
    initiatedBy: mockUser.id,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:01.000Z',
    finishedAt: null,
    retryOfRunId: null,
    params: {},
    secretRefs: {},
    strategy: {},
    cancelRequestedAt: null,
    counts: { total: targets.length, pending: targets.length },
    targets,
    ...over,
  };
}

export function makeApproval(over: Partial<RunbookApproval> = {}): RunbookApproval {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    runId: RUN_ID,
    runTargetId: null,
    scope: 'run',
    kind: 'gate',
    stepIndex: 1,
    stepName: 'Confirm rollout',
    message: 'Check the canary before continuing',
    status: 'pending',
    expiresAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    decidedBy: null,
    decidedAt: null,
    comment: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    runbookName: 'Patch web tier',
    runbookVersion: 3,
    initiatedBy: 'someone-else',
    initiatedByName: 'Person B',
    targetName: null,
    ...over,
  };
}
