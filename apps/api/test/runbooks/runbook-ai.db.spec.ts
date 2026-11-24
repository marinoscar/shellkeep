// =============================================================================
// The AI runbook step, end to end over a real database, a real shell and a scripted AI provider (issue #64)
// =============================================================================
//
// Real Postgres under an ORDINARY role (forced row-level security), the in-process SSH server that runs what
// the engine pipes in, the real handlers and coordinator, and the platform's real `AiService` over a scripted
// `FakeAiProvider`: every request the model would have seen is in `h.ai.fake.calls`. Run with `npm run test:db`.
//
// What these prove (epic #35):
//   * in `per_command` mode no command runs without an `approved` approval row;
//   * in `autonomous_within_allowlist` mode no command runs that fails the allow list, matches the deny list
//     or is destructive (`mkfs.ext4` with an allow list of `.*`);
//   * a secret never reaches an AI input, a job payload, a log, an event, an audit row or a span.
// =============================================================================

import { Logger } from '@nestjs/common';
import { AiError } from '@marinoscar/platform-api/ai';
import { runInOrg } from '@marinoscar/platform-api/core';

import { resolveDbSuite } from '../helpers/db-test-support';
import { createHarness, ORG_A, type Harness } from './engine-harness';

const { describeWithDb } = resolveDbSuite('runbook-ai.db.spec');

/** Assembled at run time: no secret-shaped literal sits in the source. */
const SENTINEL = ['sentinel', 'token', Math.random().toString(36).slice(2, 12)].join('-');

const who = (h: Harness, userId = h.userA) =>
  ({ userId, activeOrgId: ORG_A, permissions: ['runbooks:read', 'runbooks:run', 'runbooks:approve', 'ai:use'] }) as never;

const cmd = (id: string, command: string, over: Record<string, unknown> = {}) => ({ id, name: id, kind: 'command', command, ...over });
const ai = (over: Record<string, unknown> = {}) => ({
  id: 'agent',
  name: 'Agent',
  kind: 'ai_task',
  goal: 'Check the server and report',
  approvalMode: 'autonomous_within_allowlist',
  allow: ['^(echo|uname|cat|ls) '],
  deny: ['forbidden'],
  ...over,
});
const definition = (step: Record<string, unknown>, extra: Record<string, unknown>[] = [cmd('after', 'echo after-the-agent', { when: 'always' })], parameters: unknown[] = []) =>
  ({ schemaVersion: 1, parameters, steps: [step, ...extra] }) as never;

const call = (command: string, reason = 'because', callId = `call-${Math.random().toString(36).slice(2, 8)}`) => ({
  output: [{ type: 'function_call' as const, callId, name: 'run_command', arguments: JSON.stringify({ command, reason }) }],
});
const text = (outputText: string) => ({ outputText });
const requestOf = (h: Harness, index: number) => h.ai.fake.calls.filter((c) => c.method.startsWith('responses'))[index]!.request!;
const providerCalls = (h: Harness) => h.ai.fake.calls.filter((c) => c.method.startsWith('responses')).length;

describeWithDb('The AI runbook step (real Postgres, real shell, scripted AI)', () => {
  let h: Harness;
  let server: string;
  let runId2 = '';

  async function launch(def: unknown, extra: Record<string, unknown> = {}): Promise<string> {
    const { runbookId } = await h.addRunbook(`ai-${Math.random().toString(36).slice(2, 8)}`, def as never);
    const { runId } = await h.runs.create(who(h), runbookId, { params: {}, secretRefs: {}, targets: { serverIds: [server] }, ...extra } as never);
    return runId;
  }
  const executions = (runId: string) =>
    runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookCommandExecution.findMany({ where: { step: { runId } }, orderBy: { startedAt: 'asc' } }));
  const approvals = (runId: string) => runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookApproval.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } }));
  const sent = () => h.fixture.stdins.join('\n---\n');

  beforeAll(async () => {
    h = await createHarness('runbook-ai');
    server = await h.addServer('server-a');
  }, 180_000);

  afterAll(async () => {
    await h?.close();
  });

  beforeEach(() => {
    h.script.length = 0;
    h.ai.fake.calls.length = 0;
    h.ai.setPolicy({ enabled: true });
    h.settings.current = { ...h.settings.current, ai: { agentEnabled: true } };
  });

  describe('autonomous_within_allowlist', () => {
    it('runs the allowed commands, refuses the denied one, and hands the target to the next step', async () => {
      h.script.push(call('echo hello-one'), call('echo forbidden-two'), call('uname -s'), text('All checked'));
      const runId = await launch(definition(ai()));
      await h.drain();

      const { run, steps } = await h.snapshot(runId);
      expect(run.status).toBe('succeeded');
      expect(steps.map((s) => s.status)).toEqual(['succeeded', 'succeeded']);
      expect(steps[0]).toMatchObject({ kind: 'ai_task', aiSummary: 'All checked', errorCode: null, aiTranscript: null });

      const rows = await executions(runId);
      const ai_rows = rows.filter((r) => r.origin === 'ai_agent');
      expect(ai_rows.map((r) => r.outcome)).toEqual(['succeeded', 'refused', 'succeeded']);
      expect(ai_rows.every((r) => /^[0-9a-f]{64}$/.test(r.commandSha256))).toBe(true);
      expect(ai_rows[1]!.finishedAt).not.toBeNull();
      // the refused one never reached the server; the other two did; the step after the agent ran too
      expect(sent()).toContain('echo hello-one');
      expect(sent()).toContain('uname -s');
      expect(sent()).not.toContain('forbidden-two');
      expect(sent()).toContain('after-the-agent');
      expect(providerCalls(h)).toBe(4);

      // the second request carries the first command's result, cleaned
      const second = JSON.stringify(requestOf(h, 1).input);
      expect(second).toContain('hello-one');
      expect(second).toContain('exitCode');
      // the refusal was answered to the model as data
      expect(JSON.stringify(requestOf(h, 2).input)).toContain('refused');
    }, 90_000);

    it('refuses a destructive command even when the allow list is `.*` (mkfs.ext4)', async () => {
      h.script.push(call('mkfs.ext4 /dev/null'), call('echo carry-on'), text('done'));
      const runId = await launch(definition(ai({ allow: ['.*'], deny: [] })));
      await h.drain();
      const rows = (await executions(runId)).filter((r) => r.origin === 'ai_agent');
      expect(rows.map((r) => r.outcome)).toEqual(['refused', 'succeeded']);
      expect(rows[0]!.commandPreview).toContain('mkfs.ext4');
      expect(sent()).not.toContain('mkfs');
      expect(sent()).toContain('carry-on');
    }, 90_000);

    it('refuses a command that matches no allow pattern, and one that names a sensitive path', async () => {
      h.script.push(call('hostname'), call('cat /etc/shadow'), text('gave up'));
      const runId = await launch(definition(ai()));
      await h.drain();
      const rows = (await executions(runId)).filter((r) => r.origin === 'ai_agent');
      expect(rows.map((r) => r.outcome)).toEqual(['refused', 'refused']);
      expect(sent()).not.toContain('hostname');
      expect(sent()).not.toContain('/etc/shadow');
    }, 90_000);

    it('aborts the step after three refusals with AI_POLICY_VIOLATIONS, and the always step still runs', async () => {
      h.script.push(call('echo forbidden-1'), call('echo forbidden-2'), call('echo forbidden-3'), text('never reached'));
      const runId = await launch(definition(ai()));
      await h.drain();
      const { run, steps } = await h.snapshot(runId);
      expect(steps[0]).toMatchObject({ status: 'failed', errorCode: 'AI_POLICY_VIOLATIONS' });
      expect(steps[1]!.status).toBe('succeeded');
      expect(run.targets[0]).toMatchObject({ status: 'failed' });
      expect((await executions(runId)).filter((r) => r.outcome === 'refused')).toHaveLength(3);
      expect(providerCalls(h)).toBe(3);
    }, 90_000);

    it('respects maxSteps: the last round\'s calls are not executed', async () => {
      h.script.push(call('echo round-1'), call('echo round-2'), call('echo round-3'));
      const runId = await launch(definition(ai({ maxSteps: 2 })));
      await h.drain();
      const { steps } = await h.snapshot(runId);
      expect(steps[0]).toMatchObject({ status: 'failed', errorCode: 'AI_STEP_LIMIT' });
      expect(providerCalls(h)).toBe(2);
      expect(sent()).toContain('round-1');
      expect(sent()).not.toContain('round-2');
    }, 90_000);

    it('reads files and lists directories through the same audited path, and refuses a private key', async () => {
      const read = { output: [{ type: 'function_call' as const, callId: 'r1', name: 'read_file', arguments: JSON.stringify({ path: '/etc/hostname' }) }] };
      const list = { output: [{ type: 'function_call' as const, callId: 'l1', name: 'list_dir', arguments: JSON.stringify({ path: '/etc' }) }] };
      const key = { output: [{ type: 'function_call' as const, callId: 'k1', name: 'read_file', arguments: JSON.stringify({ path: '/srv/tls/site.pem' }) }] };
      h.script.push(read, list, key, text('read'));
      const runId = await launch(definition(ai()));
      await h.drain();
      const rows = (await executions(runId)).filter((r) => r.origin === 'ai_agent');
      expect(rows.map((r) => r.outcome)).toEqual(['succeeded', 'succeeded', 'refused']);
      expect(rows[0]!.commandPreview).toBe("head -c 16384 -- '/etc/hostname'");
      expect(rows[1]!.commandPreview).toBe("ls -la -- '/etc'");
      expect(sent()).not.toContain('site.pem');
    }, 90_000);
  });

  describe('per_command', () => {
    const perCommand = (over: Record<string, unknown> = {}) => ai({ approvalMode: 'per_command', allow: [], deny: ['forbidden'], ...over });

    it('never runs a command without an approved row: it parks the target, approves, resumes and runs exactly that command', async () => {
      h.script.push(call('echo needs-approval', 'show the banner', 'call-A'), text('Summary after approval'));
      const before = h.fixture.stdins.length;
      const runId = await launch(definition(perCommand()));
      await h.drain();

      // parked: an approval row, a stored conversation, nothing executed, one provider call
      let snap = await h.snapshot(runId);
      expect(snap.run.targets[0]!.status).toBe('waiting');
      expect(snap.steps[0]).toMatchObject({ status: 'waiting_approval' });
      expect((snap.steps[0]!.aiTranscript as { awaiting: { callId: string } }).awaiting.callId).toBe('call-A');
      const [pending] = await approvals(runId);
      expect(pending).toMatchObject({ kind: 'ai_command', status: 'pending', scope: 'target', stepIndex: 0, message: 'show the banner' });
      expect(pending!.payload).toMatchObject({ command: 'echo needs-approval', reason: 'show the banner' });
      expect(await executions(runId)).toHaveLength(0);
      expect(h.fixture.stdins.slice(before).join('')).not.toContain('needs-approval');
      expect(providerCalls(h)).toBe(1);

      // the starter may not approve their own AI command
      await expect(h.approvals.decide(who(h), pending!.id, 'approve')).rejects.toMatchObject({ response: { code: 'RUNBOOK_SELF_APPROVAL' } });
      expect(await executions(runId)).toHaveLength(0);

      await h.approvals.decide(who(h, h.userB), pending!.id, 'approve');
      snap = await h.snapshot(runId);
      expect(snap.steps[0]!.status).toBe('running');
      await h.drain();

      snap = await h.snapshot(runId);
      expect(snap.run.status).toBe('succeeded');
      expect(snap.steps.map((s) => s.status)).toEqual(['succeeded', 'succeeded']);
      expect(snap.steps[0]).toMatchObject({ aiSummary: 'Summary after approval', aiTranscript: null });
      const rows = await executions(runId);
      expect(rows).toHaveLength(2); // the AI command and the step after it
      expect(rows[0]).toMatchObject({ origin: 'ai_agent', outcome: 'succeeded', approvedBy: h.userB });
      expect(sent()).toContain('echo needs-approval');
      // the resume replayed the conversation: the second request holds the call and its output
      expect(providerCalls(h)).toBe(2);
      const replay = JSON.stringify(requestOf(h, 1).input);
      expect(replay).toContain('call-A');
      expect(replay).toContain('needs-approval');
      // the decision was audited with its approver
      const audit = await h.prisma.auditEvent.findMany({ where: { action: 'runbook_approval.decided' } });
      expect(audit.some((a) => a.actorUserId === h.userB)).toBe(true);
    }, 120_000);

    it('tells the model `rejected` when a person declines, and carries on', async () => {
      h.script.push(call('echo declined-one', 'try it', 'call-R'), text('Understood, stopping'));
      const runId = await launch(definition(perCommand()));
      await h.drain();
      const [pending] = await approvals(runId);
      await h.approvals.decide(who(h, h.userB), pending!.id, 'reject', 'not on prod');
      await h.drain();

      expect(sent()).not.toContain('declined-one');
      const replay = JSON.stringify(requestOf(h, 1).input);
      expect(replay).toContain('rejected');
      expect(replay).toContain('not on prod');
      const { steps } = await h.snapshot(runId);
      expect(steps[0]).toMatchObject({ status: 'succeeded', aiSummary: 'Understood, stopping' });
      expect((await executions(runId)).filter((r) => r.origin === 'ai_agent').map((r) => r.outcome)).toEqual(['rejected']);
    }, 120_000);

    it('asks again for the next command: one approval per command', async () => {
      h.script.push(call('echo first-cmd', 'one', 'c1'), call('echo second-cmd', 'two', 'c2'), text('both done'));
      const runId = await launch(definition(perCommand()));
      await h.drain();
      const [first] = await approvals(runId);
      await h.approvals.decide(who(h, h.userB), first!.id, 'approve');
      await h.drain();
      const all = await approvals(runId);
      expect(all).toHaveLength(2);
      expect(all[1]).toMatchObject({ status: 'pending', kind: 'ai_command' });
      expect(sent()).toContain('first-cmd');
      expect(sent()).not.toContain('second-cmd');
      await h.approvals.decide(who(h, h.userB), all[1]!.id, 'approve');
      await h.drain();
      expect(sent()).toContain('second-cmd');
      expect((await h.snapshot(runId)).run.status).toBe('succeeded');
    }, 150_000);

    it('refuses a denied command without asking anyone', async () => {
      h.script.push(call('echo forbidden-x'), text('ok'));
      const runId = await launch(definition(perCommand()));
      await h.drain();
      expect(await approvals(runId)).toHaveLength(0);
      expect((await executions(runId)).filter((r) => r.origin === 'ai_agent').map((r) => r.outcome)).toEqual(['refused']);
    }, 90_000);

    it('fails the step with APPROVAL_EXPIRED when nobody decides, and the run goes on', async () => {
      h.script.push(call('echo never-approved'));
      const runId = await launch(definition(perCommand()));
      await h.drain();
      expect(await h.approvals.expireDue(ORG_A, new Date(Date.now() + 3 * 86_400_000))).toBe(1);
      await h.drain();
      const { run, steps } = await h.snapshot(runId);
      expect(steps[0]).toMatchObject({ status: 'failed', errorCode: 'APPROVAL_EXPIRED', aiTranscript: null });
      expect(steps[1]!.status).toBe('succeeded'); // `when: always`
      expect(run.targets[0]!.status).toBe('failed');
      expect(sent()).not.toContain('never-approved');
    }, 120_000);
  });

  describe('plan', () => {
    const plan = (over: Record<string, unknown> = {}) => ai({ approvalMode: 'plan', allow: [], deny: ['forbidden'], ...over });
    const planJson = (commands: Array<{ command: string; reason: string }>) => ({ outputText: JSON.stringify({ summary: 'Do three things', commands }) });

    it('needs one approval, then runs exactly the approved commands in order and cannot add any', async () => {
      h.script.push(
        planJson([
          { command: 'echo plan-a', reason: 'first' },
          { command: 'echo forbidden-b', reason: 'refused by the policy' },
          { command: 'echo plan-c', reason: 'third' },
        ]),
        text('Plan outcome: all good'),
      );
      const runId = await launch(definition(plan()));
      await h.drain();

      const [approval] = await approvals(runId);
      expect(approval).toMatchObject({ kind: 'ai_plan', status: 'pending' });
      const payload = approval!.payload as { commands: Array<{ command: string; refused: string | null }> };
      expect(payload.commands.map((c) => c.refused)).toEqual([null, 'DENY_PATTERN', null]);
      expect(await executions(runId)).toHaveLength(0);
      expect(providerCalls(h)).toBe(1);

      await h.approvals.decide(who(h, h.userB), approval!.id, 'approve');
      await h.drain();
      const { run, steps } = await h.snapshot(runId);
      expect(run.status).toBe('succeeded');
      expect(steps[0]).toMatchObject({ status: 'succeeded', aiSummary: 'Plan outcome: all good' });
      expect(sent()).toContain('echo plan-a');
      expect(sent()).toContain('echo plan-c');
      expect(sent()).not.toContain('forbidden-b');
      expect(sent().indexOf('plan-a')).toBeLessThan(sent().indexOf('plan-c'));
      const rows = (await executions(runId)).filter((r) => r.origin === 'ai_agent');
      expect(rows.map((r) => r.outcome)).toEqual(['succeeded', 'refused', 'succeeded']);
      expect(rows[0]!.approvedBy).toBe(h.userB);
      // the model could not add a command: the closing call carries no tools
      expect(providerCalls(h)).toBe(2);
      expect(requestOf(h, 1).tools ?? []).toHaveLength(0);
    }, 120_000);

    it('stops at the first failing command, and a rejected plan fails the step', async () => {
      h.script.push(planJson([{ command: 'exit 7', reason: 'fails' }, { command: 'echo after-failure', reason: 'skipped' }]), text('It failed'));
      const runId = await launch(definition(plan(), [cmd('after', 'echo tail', { when: 'always' })]));
      await h.drain();
      const [approval] = await approvals(runId);
      await h.approvals.decide(who(h, h.userB), approval!.id, 'approve');
      await h.drain();
      const { steps } = await h.snapshot(runId);
      expect(steps[0]).toMatchObject({ status: 'failed', errorCode: 'STEP_FAILED' });
      expect(sent()).not.toContain('after-failure');

      h.script.push(planJson([{ command: 'echo never', reason: 'x' }]));
      const second = await launch(definition(plan()));
      await h.drain();
      const [pending] = await approvals(second);
      await h.approvals.decide(who(h, h.userB), pending!.id, 'reject');
      await h.drain();
      expect((await h.snapshot(second)).steps[0]).toMatchObject({ status: 'failed', errorCode: 'APPROVAL_REJECTED' });
      expect(sent()).not.toContain('echo never');
    }, 150_000);
  });

  describe('gates and kill switches', () => {
    it('fails with AI_DISABLED and zero provider calls when AI is off; no connection is opened', async () => {
      h.ai.setPolicy({ enabled: false });
      const before = h.fixture.stdins.length;
      const runId = await launch(definition(ai()));
      await h.drain();
      const { steps } = await h.snapshot(runId);
      expect(steps[0]).toMatchObject({ status: 'failed', errorCode: 'AI_DISABLED' });
      expect(providerCalls(h)).toBe(0);
      expect(await executions(runId).then((r) => r.filter((x) => x.origin === 'ai_agent'))).toHaveLength(0);
      // nothing the agent could have sent reached the server: only the step after it ran
      expect(h.fixture.stdins.slice(before)).toHaveLength(1);
      expect(sent()).toContain('after-the-agent');
    }, 90_000);

    it('fails with RUNBOOK_AI_DISABLED when runbooks.ai.agentEnabled is off', async () => {
      h.settings.current = { ...h.settings.current, ai: { agentEnabled: false } };
      const runId = await launch(definition(ai()));
      await h.drain();
      expect((await h.snapshot(runId)).steps[0]).toMatchObject({ status: 'failed', errorCode: 'RUNBOOK_AI_DISABLED' });
      expect(providerCalls(h)).toBe(0);
    }, 90_000);

    it('fails with AI_OUTPUT_SHARING_DISABLED when the server does not share output, with no provider call', async () => {
      const closed = await h.addServer('server-closed');
      await h.prisma.serverProfile.update({ where: { id: closed }, data: { aiOutputSharing: false } });
      const { runbookId } = await h.addRunbook('closed', definition(ai()));
      const { runId } = await h.runs.create(who(h), runbookId, { params: {}, secretRefs: {}, targets: { serverIds: [closed] } } as never);
      await h.drain();
      expect((await h.snapshot(runId)).steps[0]).toMatchObject({ status: 'failed', errorCode: 'AI_OUTPUT_SHARING_DISABLED' });
      expect(providerCalls(h)).toBe(0);
    }, 90_000);

    it('defers the job when the provider throttles before any command ran', async () => {
      h.script.push(() => {
        throw new AiError('AI_RATE_LIMITED', 'Slow down', { retryAfterMs: 5000 });
      });
      const runId = await launch(definition(ai()));
      // run the start job and the segment; then the agent job, which must be deferred, not failed
      await h.drain({ maxRounds: 3 });
      const job = await h.prisma.job.findFirstOrThrow({ where: { type: 'ai.runbook.agent' }, orderBy: { createdAt: 'desc' } });
      expect(job.status).toBe('failed'); // the harness queue marks any throw failed; the handler threw
      expect(job.lastError).toMatch(/slow down|rate/i);
      expect((await h.snapshot(runId)).steps[0]!.status).toBe('running'); // the step is untouched
    }, 90_000);

    it('"Stop AI" ends the agent before its next command runs', async () => {
      let runId = '';
      h.script.push(call('echo ran-before-stop'), async () => {
        await h.aiStop.stop(who(h), runId);
        return call('echo must-not-run');
      });
      runId = await launch(definition(ai()));
      await h.drain();
      const { steps } = await h.snapshot(runId);
      expect(steps[0]).toMatchObject({ status: 'failed', errorCode: 'AI_STOPPED' });
      expect(sent()).toContain('ran-before-stop');
      expect(sent()).not.toContain('must-not-run');
      expect(steps[1]!.status).toBe('succeeded');
    }, 90_000);

    it('fails a step whose agent job died (EXECUTOR_LOST) and the run goes on', async () => {
      const runId = await launch(definition(ai()));
      for (const type of ['runbook.run.start', 'runbook.target.run']) {
        const job = await h.prisma.job.findFirstOrThrow({ where: { type, status: 'pending' } });
        await h.prisma.job.update({ where: { id: job.id }, data: { status: 'running' } });
        await h.handlers.get(type)!.process(job as never);
        await h.prisma.job.update({ where: { id: job.id }, data: { status: 'succeeded' } });
      }
      // the agent job exists, then dies without ever finishing; the parked target has been quiet a while
      const agent = await h.prisma.job.findFirstOrThrow({ where: { type: 'ai.runbook.agent', status: 'pending' } });
      await h.prisma.job.update({ where: { id: agent.id }, data: { status: 'failed' } });
      await h.system.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
        await tx.$executeRaw`UPDATE runbook_run_targets SET updated_at = now() - interval '10 minutes' WHERE run_id = ${runId}::uuid`;
      });
      const result = await h.compact.reconcile(new Date());
      expect(result.lostAgents).toBe(1);
      await h.drain();
      const { steps } = await h.snapshot(runId);
      expect(steps[0]).toMatchObject({ status: 'failed', errorCode: 'EXECUTOR_LOST' });
      expect(steps[1]!.status).toBe('succeeded'); // the `always` step still ran
      expect(providerCalls(h)).toBe(0);
    }, 90_000);

    it('"Stop AI" fails a step parked behind an approval at once', async () => {
      h.script.push(call('echo parked-cmd'));
      runId2 = await launch(definition(ai({ approvalMode: 'per_command', allow: [] })));
      await h.drain();
      const stopped = await h.aiStop.stop(who(h), runId2);
      expect(stopped.stoppedSteps).toBe(1);
      await h.drain();
      const { steps } = await h.snapshot(runId2);
      expect(steps[0]).toMatchObject({ status: 'failed', errorCode: 'AI_STOPPED' });
      expect((await approvals(runId2))[0]).toMatchObject({ status: 'rejected', comment: 'AI stopped' });
      expect(sent()).not.toContain('parked-cmd');
    }, 90_000);
  });

  describe('secrets', () => {
    it('keeps a secret parameter and a printed secret out of every AI input, payload, log, event and audit row', async () => {
      h.secrets.set('agent-token', SENTINEL);
      // shaped like an AWS access key id, assembled at run time
      const printed = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
      h.script.push(call(`echo "$TOKEN"; echo "${printed}"`), text('inspected'));
      const logged: string[] = [];
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) => jest.spyOn(Logger.prototype, m).mockImplementation((...args: unknown[]) => void logged.push(JSON.stringify(args))));
      const { runbookId } = await h.addRunbook(
        'ai-secrets',
        definition(ai({ goal: 'Print the token variable name and check it' }), [cmd('after', 'true', { when: 'always' })], [{ name: 'TOKEN', type: 'secret', required: true }]),
      );
      const { runId } = await h.runs.create(who(h), runbookId, { params: {}, secretRefs: { TOKEN: 'agent-token' }, targets: { serverIds: [server] } } as never);
      await h.drain();
      spies.forEach((s) => s.mockRestore());

      const { run, steps } = await h.snapshot(runId);
      expect(run.status).toBe('succeeded');
      // the value DID travel to the server, on stdin
      expect(sent()).toContain(SENTINEL);
      // the model's second request holds the command's output, redacted
      const second = JSON.stringify(requestOf(h, 1).input);
      expect(second).toContain('[REDACTED:literal]');
      // the model was told the NAME and never the value
      expect(String(requestOf(h, 0).instructions)).toContain('$TOKEN');

      const everywhere = {
        providerCalls: h.ai.fake.calls,
        jobs: await h.prisma.job.findMany({ select: { payload: true, subjectId: true, lastError: true } }),
        run,
        steps,
        executions: await executions(runId),
        approvals: await approvals(runId),
        chunks: await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookRunLogChunk.findMany()),
        stored: [...h.storage.values()].map((b) => b.toString()),
        bus: h.bus.published,
        logged,
        usage: h.ai.usageEvents,
        audit: await h.prisma.auditEvent.findMany(),
        notifications: [h.notifications.notify.mock.calls, h.notifications.notifyPermissionHolders.mock.calls],
      };
      const blob = JSON.stringify(everywhere, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
      expect(blob).not.toContain(SENTINEL);
      // the key-shaped value a command printed reached the log and the model only as a redaction token
      expect(blob).not.toContain(printed);
      expect(second).toContain('[REDACTED:aws_access_key]');
    }, 120_000);
  });
});
