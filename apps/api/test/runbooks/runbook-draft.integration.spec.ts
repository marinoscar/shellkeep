// =============================================================================
// AI drafting of a runbook (issue #64)
// =============================================================================
//
// The real `RunbookDraftService` over the platform's real `AiService` and a scripted `FakeAiProvider`. The
// route's guards (`AiEnabledGuard`, the organization interceptor, `ai:use`) are the platform's and are proved by
// the `ai-kill-switch` and `ai-rbac-matrix` suites (`test/conformance.spec.ts`), which discover the route.
//
// What these prove: the answer is validated like a save (an invalid one is never returned), warnings flag a
// risky command, nothing is saved, only the facts of servers the caller may read reach the model, and with AI
// off or without `runbooks:write` the provider is never called.
// =============================================================================

import { AiError } from '@marinoscar/platform-api/ai';
import { createAiRuntimeHarness, HARNESS_ORG, HARNESS_USER, type AiRuntimeHarness } from '@marinoscar/platform-api/ai/testing';

import '../../src/app-registrations/ai';
import { RunbookDraftService } from '../../src/runbooks/ai/runbook-draft.service';
import { runbookDefinitionSchema } from '../../src/runbooks/schema/runbook-definition.schema';

const KNOWN_SERVER = '11111111-aaaa-4aaa-8aaa-111111111111';
const HIDDEN_SERVER = '22222222-bbbb-4bbb-8bbb-222222222222';

const principal = (permissions: string[] = ['ai:use', 'runbooks:write']) =>
  ({ userId: HARNESS_USER, activeOrgId: HARNESS_ORG, permissions }) as never;

const step = (over: Record<string, unknown>) => ({ id: 'one', name: 'One', kind: 'command', command: 'uptime', ...over });
const answer = (steps: unknown[], extra: Record<string, unknown> = {}) => ({
  outputText: JSON.stringify({ schemaVersion: 1, parameters: [], steps, ...extra }),
});

describe('AI drafting of a runbook', () => {
  let harness: AiRuntimeHarness;
  let service: RunbookDraftService;
  let findOne: jest.Mock;
  let next: unknown;

  const providerCalls = () => harness.fake.calls.filter((c) => c.method.startsWith('responses'));

  beforeEach(() => {
    next = answer([step({})]);
    harness = createAiRuntimeHarness({ fake: { responses: () => next as never }, defaultModel: { provider: 'openai', modelId: 'fake-model' } });
    findOne = jest.fn(async (id: string) => {
      if (id === HIDDEN_SERVER) throw new Error('not found');
      return { id, name: 'server-a', facts: { kernel: 'Linux 6.1', os: 'linux', prettyName: 'Distro X 1', packageManager: 'apt', shell: '/bin/bash', has: [] } };
    });
    service = new RunbookDraftService(
      harness.ai,
      { parseDefinition: (input: unknown) => runbookDefinitionSchema.parse(input) } as never,
      { findOne } as never,
    );
  });

  it('returns a definition valid under the runbook schema, with a warning for a risky command, and saves nothing', async () => {
    next = answer([step({ id: 'clean', name: 'Clean', command: 'rm -rf /var/lib/x' }), step({ id: 'logs', name: 'Logs', kind: 'collect_logs', command: undefined, paths: ['/var/log/syslog'], when: 'always' })]);
    const result = await service.draft(principal(), { prompt: 'Clean the old cache and collect logs' } as never);

    expect(runbookDefinitionSchema.safeParse(result.definition).success).toBe(true);
    expect(result.definition.steps.map((s) => s.id)).toEqual(['clean', 'logs']);
    const risky = result.warnings.find((w) => w.path[1] === 0 && w.code.startsWith('RISK_'));
    expect(risky).toBeDefined();
    expect(risky!.message).toMatch(/delete/i);
    expect(result.risk.findings.some((f) => f.stepIndex === 0)).toBe(true);
    // the warnings never carry the command text
    expect(JSON.stringify(result.warnings)).not.toContain('/var/lib/x');
    expect(providerCalls()).toHaveLength(1);
  });

  it('tells the model to keep secrets out, to prefer the managed steps and to collect logs with `when: always`', async () => {
    await service.draft(principal(), { prompt: 'Update packages' } as never);
    const request = providerCalls()[0]!.request!;
    const instructions = String(request.instructions);
    expect(instructions).toMatch(/NEVER write a secret/);
    expect(instructions).toContain('type "secret"');
    expect(instructions).toContain('package_update');
    expect(instructions).toContain('collect_logs');
    expect(instructions).toContain('when: "always"');
    expect(JSON.stringify(request.input)).toContain('Update packages');
  });

  it('never returns a draft that a save would refuse', async () => {
    // autonomous mode with no allow pattern is a cross-field error of the definition
    next = answer([{ id: 'a', name: 'A', kind: 'ai_task', goal: 'g', approvalMode: 'autonomous_within_allowlist', allow: [], deny: [] }]);
    await expect(service.draft(principal(), { prompt: 'x' } as never)).rejects.toMatchObject({ code: 'AI_STRUCTURED_OUTPUT_INVALID' });
    next = { outputText: 'not json at all' };
    await expect(service.draft(principal(), { prompt: 'x' } as never)).rejects.toMatchObject({ code: 'AI_STRUCTURED_OUTPUT_INVALID' });
  });

  it('flags something secret-shaped in the draft', async () => {
    const key = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
    next = answer([step({ command: `aws s3 ls --access-key ${key}` })]);
    const result = await service.draft(principal(), { prompt: 'x' } as never);
    expect(result.warnings.map((w) => w.code)).toContain('SECRET_IN_DRAFT');
  });

  it('gives the model the facts of a hinted server the caller may read, and nothing of one they may not', async () => {
    await service.draft(principal(), { prompt: 'x', targetHint: { serverIds: [KNOWN_SERVER, HIDDEN_SERVER], tags: ['web'] } } as never);
    const input = JSON.stringify(providerCalls()[0]!.request!.input);
    expect(input).toContain('Distro X 1');
    expect(input).toContain('package manager apt');
    expect(input).toContain('web');
    expect(input).not.toContain(HIDDEN_SERVER);
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('answers AI_DISABLED with zero provider calls when AI is off', async () => {
    harness.setPolicy({ enabled: false });
    await expect(service.draft(principal(), { prompt: 'x' } as never)).rejects.toBeInstanceOf(AiError);
    await expect(service.draft(principal(), { prompt: 'x' } as never)).rejects.toMatchObject({ code: 'AI_DISABLED' });
    expect(providerCalls()).toHaveLength(0);
  });

  it('refuses a caller without runbooks:write before any provider call', async () => {
    await expect(service.draft(principal(['ai:use']), { prompt: 'x' } as never)).rejects.toMatchObject({ status: 403 });
    expect(providerCalls()).toHaveLength(0);
  });
});
