// The agent job against the platform's job-handler conformance kit (#64): the static contract (a dotted `ai.*`
// type, a label, a two-number profile, neither node member), a payload that is not ours failing loudly, and the
// permanence of the type string. The behaviour is `test/runbooks/runbook-ai.db.spec.ts`.

import { describeJobHandlerConformance } from '@marinoscar/platform-api/jobs/testing';

import { RunbookAgentHandler } from './runbook-agent.handler';
import { RUNBOOK_AGENT_TYPE } from './runbook-agent.constants';

const RUN = '9d5b1c34-1c3e-4e53-a1d3-0d7c9a1f1a01';
const TARGET = '9d5b1c34-1c3e-4e53-a1d3-0d7c9a1f1a02';
const ORG = '9d5b1c34-1c3e-4e53-a1d3-0d7c9a1f1a03';

/** A client whose every table is empty: `runInOrg`'s transaction runs the callback over it. */
function emptyTx(): Record<string, unknown> {
  const delegate = {
    findUnique: async () => null,
    findFirst: async () => null,
    findMany: async () => [],
    aggregate: async () => ({ _max: {}, _sum: {} }),
  };
  return { $executeRaw: async () => 0, runbookRun: delegate, runbookRunTarget: delegate, runbookRunStep: delegate, runbookVersion: delegate };
}
const stubPrisma = { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(emptyTx()), $executeRaw: async () => 0, $connect: async () => undefined, $extends: () => undefined } as never;
const unused = {} as never;

const build = () =>
  new RunbookAgentHandler({ register: () => undefined } as never, stubPrisma, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused, unused);

describeJobHandlerConformance(RUNBOOK_AGENT_TYPE, build, {
  payloads: [
    {
      // The run is gone: the job is a no-op, so the second run changes nothing. Behaviour proper is `test/runbooks/runbook-ai.db.spec.ts`.
      name: 'a step of a run that no longer exists is a no-op',
      payload: { runId: RUN, targetId: TARGET, stepIndex: 0, orgId: ORG, phase: 'start' },
      subjectType: 'runbook_run_target',
      subjectId: TARGET,
      orgId: ORG,
      reason: 'runbook_run',
    },
    { name: 'a payload that is not ours', payload: { runId: 'nope' }, expectFailure: 'Invalid ai.runbook.agent payload' },
  ],
});

describe('RunbookAgentHandler', () => {
  it('is server-only for good: no node result schema, no node persistence', () => {
    const handler = build() as unknown as Record<string, unknown>;
    expect(handler.nodeResultSchema).toBeUndefined();
    expect(handler.persistNodeResult).toBeUndefined();
    expect(handler.type).toBe('ai.runbook.agent');
    expect(handler.profile).toEqual({ maxRuntimeMs: 30 * 60_000, maxAttempts: 1 });
  });

  it('refuses a payload whose organization is not the job\'s', async () => {
    const payload = { runId: '11111111-1111-4111-8111-111111111111', targetId: '22222222-2222-4222-8222-222222222222', stepIndex: 0, orgId: '33333333-3333-4333-8333-333333333333', phase: 'start' };
    await expect(build().process({ id: 'j', type: RUNBOOK_AGENT_TYPE, payload, orgId: null, attempts: 1 } as never)).rejects.toThrow('needs the organization');
  });
});
