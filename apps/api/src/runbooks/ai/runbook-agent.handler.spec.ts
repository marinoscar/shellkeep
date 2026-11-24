// The agent job against the platform's job-handler conformance kit (#64): the static contract (a dotted `ai.*`
// type, a label, a two-number profile, neither node member), a payload that is not ours failing loudly, and the
// permanence of the type string. The behaviour is `test/runbooks/runbook-ai.db.spec.ts`.

import { describeJobHandlerConformance } from '@marinoscar/platform-api/jobs/testing';

import { RunbookAgentHandler } from './runbook-agent.handler';
import { RUNBOOK_AGENT_TYPE } from './runbook-agent.constants';

const build = () => new RunbookAgentHandler({ register: () => undefined } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);

describeJobHandlerConformance(RUNBOOK_AGENT_TYPE, build, {
  payloads: [{ name: 'a payload that is not ours', payload: { runId: 'nope' }, expectFailure: 'Invalid ai.runbook.agent payload' }],
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
