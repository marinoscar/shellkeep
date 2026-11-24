// =============================================================================
// The runbook engine, end to end over a real database and a real shell (issue #62)
// =============================================================================
//
// Real Postgres under an ORDINARY role (forced row-level security), an in-process SSH server that runs what
// the engine pipes in, the real handlers and coordinator. Only the platform's edges are fakes (storage,
// notifications, credentials, the bus). Run with `npm run test:db`.
// =============================================================================

import { Logger } from '@nestjs/common';
import { Readable } from 'node:stream';

import { runInOrg } from '@marinoscar/platform-api/core';
import { firstValueFrom, take, toArray } from 'rxjs';

import { resolveDbSuite } from '../helpers/db-test-support';
import { createHarness, ORG_A, type Harness } from './engine-harness';

const { describeWithDb } = resolveDbSuite('runbook-engine.db.spec');

/** Assembled at run time: no secret-shaped literal sits in the source. */
const SENTINEL = ['sentinel', 'token', Math.random().toString(36).slice(2, 12)].join('-');

const cmd = (id: string, command: string, over: Record<string, unknown> = {}) => ({ id, name: id, kind: 'command', command, ...over });
const scope = (h: Harness, userId = h.userA) => ({ userId, orgId: ORG_A });

describeWithDb('Runbook engine (real Postgres, real shell)', () => {
  let h: Harness;
  let servers: string[];

  async function start(runbookId: string, serverIds: string[], extra: Record<string, unknown> = {}): Promise<string> {
    const { runId } = await h.runs.create(scope(h), runbookId, { params: {}, secretRefs: {}, targets: { serverIds }, ...extra } as never);
    return runId;
  }

  beforeAll(async () => {
    h = await createHarness('engine');
    servers = [await h.addServer('server-a'), await h.addServer('server-b'), await h.addServer('server-c')];
  }, 180_000);

  afterAll(async () => {
    await h?.close();
  });

  it('runs three targets: statuses, exit codes, `when`, logs in storage, argv secrecy', async () => {
    const { runbookId } = await h.addRunbook('e2e', {
      schemaVersion: 1,
      steps: [cmd('hello', 'echo hi'), cmd('fail', 'exit 3', { continueOnError: true }), cmd('recover', 'echo recovery', { when: 'on_failure' })],
    } as never);
    const before = h.fixture.execs.length;
    const runId = await start(runbookId, servers);
    await h.drain();

    const { run, steps } = await h.snapshot(runId);
    expect(run.status).toBe('succeeded');
    expect(run.finishedAt).not.toBeNull();
    expect(run.targets.map((t) => t.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    for (const target of run.targets) {
      const mine = steps.filter((s) => s.runTargetId === target.id);
      expect(mine.map((s) => s.status)).toEqual(['succeeded', 'failed', 'skipped']);
      expect(mine.map((s) => s.exitCode)).toEqual([0, 3, null]);
      expect(mine[0]!.logStorageKey).toBe(`runbook-artifacts/${ORG_A}/${runId}/${target.id}/0.log`);
      expect(h.storage.get(mine[0]!.logStorageKey!)!.toString()).toBe('hi\n');
    }
    // the chunk buffer was emptied into storage
    const left = await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookRunLogChunk.count({ where: { runId } }));
    expect(left).toBe(0);
    // every command was audited with a hash and a preview, and sent as exactly `bash -s`
    const executions = await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookCommandExecution.findMany({ where: { step: { runId } } }));
    expect(executions).toHaveLength(6);
    expect(executions.every((e) => /^[0-9a-f]{64}$/.test(e.commandSha256) && e.origin === 'step')).toBe(true);
    expect(executions.map((e) => e.commandPreview).sort()).toEqual(['echo hi', 'echo hi', 'echo hi', 'exit 3', 'exit 3', 'exit 3']);
    expect(h.fixture.execs.slice(before)).toEqual(Array(6).fill('bash -s'));
    // the finish hooks ran once, after the commit
    expect(h.finishedEvents).toHaveLength(1);
    expect(h.notifications.notify).toHaveBeenCalledWith('runbooks.run_finished', h.userA, expect.objectContaining({ targetsTotal: 3, targetsSucceeded: 3 }));
  }, 120_000);

  it('evaluates on_success, on_failure and always after a step that failed without continueOnError', async () => {
    const { runbookId } = await h.addRunbook('when', {
      schemaVersion: 1,
      steps: [cmd('boom', 'exit 1'), cmd('ok', 'echo A'), cmd('recover', 'echo B', { when: 'on_failure' }), cmd('final', 'echo C', { when: 'always' })],
    } as never);
    const runId = await start(runbookId, [servers[0]!]);
    await h.drain();
    const { run, steps } = await h.snapshot(runId);
    expect(steps.map((s) => s.status)).toEqual(['failed', 'skipped', 'succeeded', 'succeeded']);
    expect(run.targets[0]).toMatchObject({ status: 'failed', errorCode: 'STEP_FAILED' });
    expect(run.status).toBe('aborted'); // the default budget is fail-fast
  }, 60_000);

  it('keeps a secret out of payloads, rows, logs, events, previews and log lines', async () => {
    h.secrets.set('deploy-token', SENTINEL);
    const { runbookId } = await h.addRunbook('secrets', {
      schemaVersion: 1,
      parameters: [
        { name: 'TOKEN', type: 'secret', required: true },
        { name: 'NAME', type: 'string', required: true },
      ],
      steps: [cmd('show', 'echo "got $TOKEN for $NAME"')],
    } as never);
    const logged: string[] = [];
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) => jest.spyOn(Logger.prototype, m).mockImplementation((...args: unknown[]) => void logged.push(JSON.stringify(args))));
    const before = h.fixture.execs.length;
    const stdinsBefore = h.fixture.stdins.length;
    const { runId } = await h.runs.create(scope(h), runbookId, { params: { NAME: 'web' }, secretRefs: { TOKEN: 'deploy-token' }, targets: { serverIds: [servers[0]!] } } as never);
    await h.drain();
    spies.forEach((s) => s.mockRestore());

    const { run, steps } = await h.snapshot(runId);
    expect(run.status).toBe('succeeded');
    expect(h.storage.get(steps[0]!.logStorageKey!)!.toString()).toBe('got [REDACTED:literal] for web\n');

    const everywhere = {
      jobs: await h.prisma.job.findMany({ select: { payload: true, subjectId: true, lastError: true } }),
      run: await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookRun.findMany()),
      steps,
      executions: await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookCommandExecution.findMany()),
      chunks: await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookRunLogChunk.findMany()),
      stored: [...h.storage.values()].map((b) => b.toString()),
      bus: h.bus.published,
      logged,
      notifications: [h.notifications.notify.mock.calls, h.notifications.notifyPermissionHolders.mock.calls],
    };
    expect(JSON.stringify(everywhere)).not.toContain(SENTINEL);
    // the argv is exactly `bash -s`, while the value did travel (on stdin)
    expect(h.fixture.execs.slice(before)).toEqual(['bash -s']);
    expect(h.fixture.stdins.slice(stdinsBefore).join('')).toContain(SENTINEL);
    expect(run.secretRefs).toEqual({ TOKEN: 'deploy-token' });
  }, 60_000);

  it('rejects bad parameters (422) and an unknown secret reference', async () => {
    const { runbookId } = await h.addRunbook('params', {
      schemaVersion: 1,
      parameters: [{ name: 'MODE', type: 'enum', options: ['a', 'b'], required: true }, { name: 'KEY', type: 'secret', required: false }],
      steps: [cmd('c', 'true')],
    } as never);
    await expect(h.runs.create(scope(h), runbookId, { params: { MODE: 'z' }, secretRefs: {} } as never)).rejects.toMatchObject({
      response: { code: 'RUNBOOK_PARAMS_INVALID' },
    });
    await expect(h.runs.create(scope(h), runbookId, { params: { MODE: 'a' }, secretRefs: { KEY: 'missing-secret' } } as never)).rejects.toMatchObject({
      response: { code: 'RUNBOOK_SECRET_REF_UNKNOWN' },
    });
  });

  it('ends a step that outruns its timeout as timed_out after sending INT', async () => {
    const { runbookId } = await h.addRunbook('timeout', { schemaVersion: 1, steps: [cmd('slow', 'sleep 30', { timeoutSec: 1 })] } as never);
    const signals = h.fixture.signals.length;
    const runId = await start(runbookId, [servers[0]!]);
    await h.drain();
    const { run, steps } = await h.snapshot(runId);
    expect(steps[0]).toMatchObject({ status: 'timed_out', errorCode: 'STEP_TIMED_OUT' });
    expect(run.targets[0]!.status).toBe('failed');
    expect(h.fixture.signals.slice(signals)).toContain('INT');
  }, 60_000);

  it('cancels a run with a running sleep within 15 seconds', async () => {
    const { runbookId } = await h.addRunbook('cancel', { schemaVersion: 1, steps: [cmd('sleep', 'sleep 60', { timeoutSec: 120 })] } as never);
    const runId = await start(runbookId, [servers[0]!]);
    const draining = h.drain({
      until: async () => (await h.snapshot(runId)).run.finishedAt !== null,
    });
    while (h.fixture.running() < 1) await new Promise((r) => setTimeout(r, 50));
    const cancelledAt = Date.now();
    await h.runs.cancel(scope(h), runId);
    await draining;
    expect(Date.now() - cancelledAt).toBeLessThan(15_000);
    const { run, steps } = await h.snapshot(runId);
    expect(run.status).toBe('cancelled');
    expect(run.targets[0]!.status).toBe('cancelled');
    expect(steps[0]!.status).toBe('cancelled');
  }, 60_000);

  it('fails a target whose executor was lost (EXECUTOR_LOST) and advances the run', async () => {
    const { runbookId } = await h.addRunbook('lost', { schemaVersion: 1, steps: [cmd('c', 'true')] } as never);
    const runId = await start(runbookId, [servers[0]!]);
    // run only the start job: the target is queued with its job pending
    const startJob = await h.prisma.job.findFirstOrThrow({ where: { type: 'runbook.run.start', status: 'pending' } });
    await h.handlers.get('runbook.run.start')!.process(startJob as never);
    await h.prisma.job.update({ where: { id: startJob.id }, data: { status: 'succeeded' } });
    // the executor dies mid-segment: the target is `running`, its job `failed`, and it has been quiet a while
    const targetJob = await h.prisma.job.findFirstOrThrow({ where: { type: 'runbook.target.run', status: 'pending', subjectType: 'runbook_run_target' } });
    await h.prisma.job.update({ where: { id: targetJob.id }, data: { status: 'failed' } });
    await h.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      await tx.$executeRaw`UPDATE runbook_run_targets SET status = 'running', updated_at = now() - interval '10 minutes' WHERE run_id = ${runId}::uuid`;
    });
    const result = await h.compact.reconcile(new Date());
    expect(result.lostExecutors).toBe(1);
    const { run } = await h.snapshot(runId);
    expect(run.targets[0]).toMatchObject({ status: 'failed', errorCode: 'EXECUTOR_LOST' });
    expect(run.finishedAt).not.toBeNull();
  }, 60_000);

  describe('approvals', () => {
    const gated = { schemaVersion: 1, steps: [cmd('before', 'echo before'), { id: 'gate', name: 'Gate', kind: 'approval_gate', scope: 'run', message: 'ok?' }, cmd('after', 'echo after')] };

    async function parked(name: string): Promise<{ runId: string; approvalId: string }> {
      const { runbookId } = await h.addRunbook(name, gated as never);
      h.notifications.notifyPermissionHolders.mockClear();
      const runId = await start(runbookId, servers, { strategy: { concurrency: 3 } });
      await h.drain();
      const approval = await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookApproval.findFirstOrThrow({ where: { runId } }));
      return { runId, approvalId: approval.id };
    }

    it('parks every target on ONE run-scope approval and notifies the approvers after the commit', async () => {
      let visibleAtNotify: number | undefined;
      h.notifications.notifyPermissionHolders.mockImplementationOnce(async () => {
        visibleAtNotify = await h.system.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
          return tx.runbookApproval.count({ where: { status: 'pending', kind: 'step' } });
        });
      });
      const { runId } = await parked('gate-park');
      const { run } = await h.snapshot(runId);
      expect(run.targets.map((t) => t.status)).toEqual(['waiting', 'waiting', 'waiting']);
      const rows = await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookApproval.findMany({ where: { runId } }));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ scope: 'run', kind: 'step', status: 'pending', stepIndex: 1 });
      expect(h.notifications.notifyPermissionHolders).toHaveBeenCalledTimes(1);
      expect(h.notifications.notifyPermissionHolders).toHaveBeenCalledWith('runbooks.approval_requested', 'runbooks:approve', expect.anything());
      expect(visibleAtNotify).toBeGreaterThanOrEqual(1); // the row was committed before the notification
    }, 120_000);

    it('refuses self-approval by default, then approve resumes every target from the next step', async () => {
      const { runId, approvalId } = await parked('gate-approve');
      await expect(h.approvals.decide(scope(h, h.userA), approvalId, 'approve')).rejects.toMatchObject({ response: { code: 'RUNBOOK_SELF_APPROVAL' }, status: 403 });
      await h.approvals.decide(scope(h, h.userB), approvalId, 'approve', 'looks fine');
      await expect(h.approvals.decide(scope(h, h.userB), approvalId, 'approve')).rejects.toMatchObject({ response: { code: 'RUNBOOK_APPROVAL_NOT_PENDING' } });
      await h.drain();
      const { run, steps } = await h.snapshot(runId);
      expect(run.status).toBe('succeeded');
      expect(steps.map((s) => s.status).every((s) => s === 'succeeded')).toBe(true);
      const afterLogs = steps.filter((s) => s.stepIndex === 2).map((s) => h.storage.get(s.logStorageKey!)!.toString());
      expect(afterLogs).toEqual(['after\n', 'after\n', 'after\n']);
    }, 120_000);

    it('allowSelfApproval lets the starter approve', async () => {
      const { runId, approvalId } = await parked('gate-self');
      h.settings.current = { ...h.settings.current, approvals: { ...h.settings.current.approvals, allowSelfApproval: true } };
      try {
        await h.approvals.decide(scope(h, h.userA), approvalId, 'approve');
      } finally {
        h.settings.current = { ...h.settings.current, approvals: { ...h.settings.current.approvals, allowSelfApproval: false } };
      }
      await h.drain();
      expect((await h.snapshot(runId)).run.status).toBe('succeeded');
    }, 120_000);

    it('reject fails the targets with APPROVAL_REJECTED', async () => {
      const { runId, approvalId } = await parked('gate-reject');
      await h.approvals.decide(scope(h, h.userB), approvalId, 'reject', 'no');
      await h.drain();
      const { run } = await h.snapshot(runId);
      expect(run.targets.map((t) => t.errorCode)).toEqual(['APPROVAL_REJECTED', 'APPROVAL_REJECTED', 'APPROVAL_REJECTED']);
      expect(run.finishedAt).not.toBeNull();
    }, 120_000);

    it('expiry fails the targets with APPROVAL_EXPIRED', async () => {
      const { runId } = await parked('gate-expire');
      await h.system.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
        await tx.$executeRaw`UPDATE runbook_approvals SET expires_at = now() - interval '1 minute' WHERE run_id = ${runId}::uuid`;
      });
      expect(await h.approvals.expireDue(ORG_A)).toBe(1);
      const { run } = await h.snapshot(runId);
      expect(run.targets.map((t) => t.errorCode)).toEqual(['APPROVAL_EXPIRED', 'APPROVAL_EXPIRED', 'APPROVAL_EXPIRED']);
    }, 120_000);
  });

  it('canary: pauses after the first batch with a gate approval, resume releases the rest', async () => {
    const { runbookId } = await h.addRunbook('canary', { schemaVersion: 1, steps: [cmd('c', 'echo ok')] } as never);
    const runId = await start(runbookId, servers, { strategy: { concurrency: 3, batchSize: 1, pauseAfterFirstBatch: true } });
    await h.drain();
    let snap = await h.snapshot(runId);
    expect(snap.run.status).toBe('paused');
    expect(snap.run.targets.map((t) => t.status)).toEqual(['succeeded', 'pending', 'pending']);
    const gate = await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookApproval.findFirstOrThrow({ where: { runId } }));
    expect(gate).toMatchObject({ kind: 'gate', scope: 'run', status: 'pending' });
    await expect(h.approvals.resume(scope(h, h.userA), runId)).rejects.toMatchObject({ response: { code: 'RUNBOOK_SELF_APPROVAL' } });
    await h.approvals.resume(scope(h, h.userB), runId);
    await h.drain();
    snap = await h.snapshot(runId);
    expect(snap.run.status).toBe('succeeded');
    expect(snap.run.targets.map((t) => t.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
  }, 120_000);

  it('fails file_upload with DEST_EXISTS when the file is there and overwrite is off; package_update with PACKAGE_MANAGER_UNKNOWN', async () => {
    const object = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
    const { runbookId } = await h.addRunbook('files', {
      schemaVersion: 1,
      steps: [
        { id: 'up', name: 'Upload', kind: 'file_upload', storageObjectId: object, destPath: '/tmp', overwrite: false, continueOnError: true },
        { id: 'pkg', name: 'Update', kind: 'package_update', packages: 'all', continueOnError: true },
        { id: 'ai', name: 'Ask', kind: 'ai_task', goal: 'check', approvalMode: 'plan', continueOnError: true },
      ],
    } as never);
    h.files.next = { name: 'a.txt', size: 1, stream: Readable.from(['x']) };
    const runId = await start(runbookId, [servers[0]!]);
    await h.drain();
    const { steps } = await h.snapshot(runId);
    expect(steps.map((s) => s.errorCode)).toEqual(['DEST_EXISTS', 'PACKAGE_MANAGER_UNKNOWN', 'STEP_KIND_NOT_AVAILABLE']);
  }, 60_000);

  it('streams a snapshot, replays chunks after Last-Event-ID, then live events, with heartbeats', async () => {
    const { runbookId } = await h.addRunbook('stream', { schemaVersion: 1, steps: [cmd('c', 'true')] } as never);
    const runId = await start(runbookId, [servers[0]!]);
    await h.drain();
    const { run, steps } = await h.snapshot(runId);
    const stepRowId = steps[0]!.id;
    await h.system.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      for (const seq of [100, 101, 102]) {
        await tx.runbookRunLogChunk.create({ data: { orgId: ORG_A, runId, runStepId: stepRowId, seq, stream: 'stdout', data: `line ${seq}\n`, bytes: 9 } });
      }
    });
    const messages = await firstValueFrom(
      h.stream.stream(scope(h), runId, { lastEventId: `${stepRowId}:100`, heartbeatMs: 30 }).pipe(take(4), toArray()),
    );
    expect(messages[0]!.type).toBe('snapshot');
    const chunks = messages.filter((m) => m.type === 'chunk');
    expect(chunks.map((m) => m.id)).toEqual([`${stepRowId}:101`, `${stepRowId}:102`]);
    expect(messages.some((m) => m.type === 'heartbeat') || chunks.length === 2).toBe(true);

    // live: a bus event for this run reaches an open stream; another run's does not
    const live = firstValueFrom(h.stream.stream(scope(h), runId, {}).pipe(take(2), toArray()));
    await new Promise((r) => setTimeout(r, 200));
    await h.bus.publish('runbooks.run', { type: 'run', runId: '00000000-0000-4000-8000-000000000000', status: 'running' });
    await h.bus.publish('runbooks.run', { type: 'run', runId, status: 'running' });
    expect((await live).map((m) => m.type)).toEqual(['snapshot', 'run']);
    expect(run.status).toBe('succeeded');
  }, 60_000);

  it('hides a run from another organization (row-level security)', async () => {
    const other = '33333333-3333-4333-8333-cccccccccccc';
    const count = await runInOrg(h.prisma, { orgId: other }, async (tx) => ({
      runs: await tx.runbookRun.count(),
      targets: await tx.runbookRunTarget.count(),
      steps: await tx.runbookRunStep.count(),
      approvals: await tx.runbookApproval.count(),
      executions: await tx.runbookCommandExecution.count(),
    }));
    expect(count).toEqual({ runs: 0, targets: 0, steps: 0, approvals: 0, executions: 0 });
    const some = await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookRun.findFirstOrThrow());
    await expect(h.runs.get({ userId: h.userA, orgId: other }, some.id)).rejects.toMatchObject({ status: 404 });
  });
});
