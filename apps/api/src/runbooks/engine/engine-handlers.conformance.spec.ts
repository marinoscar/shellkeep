// =============================================================================
// The four runbook job handlers pass the platform's handler conformance (issue #62)
// =============================================================================
//
// `describeJobHandlerConformance` checks each handler's contract (a dotted type, a label, a profile that
// carries only `maxRuntimeMs` and `maxAttempts`, no node members for the server-only ones) and runs the
// payload scenarios twice through a fake queue: the second run must change nothing. The handlers here
// run over a database stub where the run does not exist, so the scenario that matters is the idempotent
// no-op; the behaviour proper is covered by `test/runbooks/runbook-engine.db.spec.ts`.
// =============================================================================

import { describeJobHandlerConformance } from '@marinoscar/platform-api/jobs/testing';
import { JobHandlerRegistry, JobScope } from '@marinoscar/platform-api/jobs';

import { LogsCompactHandler } from './logs-compact.handler';
import { RunAdvanceHandler } from './run-advance.handler';
import { RunStartHandler } from './run-start.handler';
import { TargetRunHandler } from './target-run.handler';

const RUN = '9d5b1c34-1c3e-4e53-a1d3-0d7c9a1f1a01';
const TARGET = '9d5b1c34-1c3e-4e53-a1d3-0d7c9a1f1a02';
const ORG = '9d5b1c34-1c3e-4e53-a1d3-0d7c9a1f1a03';

/** A client whose every table is empty: `runInOrg`'s transaction runs the callback over it. */
function emptyTx(): Record<string, unknown> {
  const delegate = {
    findUnique: async () => null,
    findFirst: async () => null,
    findMany: async () => [],
    count: async () => 0,
    groupBy: async () => [],
    create: async () => ({}),
    createMany: async () => ({ count: 0 }),
    update: async () => ({}),
    updateMany: async () => ({ count: 0 }),
  };
  return {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    runbookRun: delegate,
    runbookRunTarget: delegate,
    runbookRunStep: delegate,
    runbookRunLogChunk: delegate,
    runbookApproval: delegate,
    runbookVersion: delegate,
    runbook: delegate,
    job: delegate,
  };
}
const stubPrisma = { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(emptyTx()), $executeRaw: async () => 0, $connect: async () => undefined, $extends: () => undefined } as never;
const none = new Proxy({}, { get: () => async () => undefined }) as never;
const registry = new JobHandlerRegistry();
const jobScope = new JobScope(stubPrisma);

const startHandler = () => new RunStartHandler(registry, stubPrisma, jobScope, none, none, none, none);
const targetHandler = () =>
  new TargetRunHandler(registry, stubPrisma, jobScope, none, none, none, none, none, none, none, none, none, none, none, none);
const advanceHandler = () => new RunAdvanceHandler(registry, jobScope, { advance: async () => ({ runId: RUN, events: [], cancelRequests: [], finished: null, approvals: [], dispatched: 0 }) } as never, { afterCommit: async () => undefined } as never);
const compactHandler = () => new LogsCompactHandler(registry, stubPrisma, { runAsSystem: async () => ({ candidates: [], activeIds: new Set(), waitingAi: [], agentIds: new Set(), stuckRuns: [], approvalOrgs: [], orphans: [] }) } as never, none, none, none, none, none);

describeJobHandlerConformance('runbook.run.start', startHandler, {
  payloads: [{ name: 'a run that does not exist is a no-op', payload: { runId: RUN }, subjectType: 'runbook_run', subjectId: RUN, orgId: ORG, reason: 'runbook_run' }],
});

describeJobHandlerConformance('runbook.target.run', targetHandler, {
  payloads: [
    {
      name: 'a target that does not exist is a no-op',
      payload: { runId: RUN, targetId: TARGET, fromStepIndex: 0 },
      subjectType: 'runbook_run_target',
      subjectId: TARGET,
      orgId: ORG,
      reason: 'runbook_run',
    },
  ],
});

describeJobHandlerConformance('runbook.run.advance', advanceHandler, {
  payloads: [{ name: 'advancing is idempotent', payload: { runId: RUN }, subjectType: 'runbook_run', subjectId: RUN, orgId: ORG, reason: 'runbook_run' }],
});

describeJobHandlerConformance('runbook.logs.compact', compactHandler, {
  payloads: [{ name: 'a pass with nothing to do changes nothing', payload: null, orgId: null, reason: 'runbook_run' }],
});
