// =============================================================================
// Runbook safety over a real database and a real shell (issue #67)
// =============================================================================
//
// Dry run (the SSH fixture records only read-only probes and the command never runs), the destructive guard
// (428, confirmation, the two-person rule), the audit trail and its export. Real Postgres under an ordinary
// role; run with `npm run test:db`.
// =============================================================================

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInOrg } from '@marinoscar/platform-api/core';

import { RunbookAuditService } from '../../src/runbooks/safety/runbook-audit.service';
import { PROBE_MARKER } from '../../src/runbooks/engine/dry-run';
import { RunbookRunsService } from '../../src/runbooks/engine/runbook-runs.service';
import { resolveDbSuite } from '../helpers/db-test-support';
import { createHarness, ORG_A, type Harness } from './engine-harness';

const { describeWithDb } = resolveDbSuite('runbook-safety.db.spec');

const cmd = (id: string, command: string, over: Record<string, unknown> = {}) => ({ id, name: id, kind: 'command', command, ...over });
const who = (h: Harness, userId = h.userA) =>
  ({ userId, activeOrgId: ORG_A, permissions: ['runbooks:read', 'runbooks:run', 'runbooks:approve'] }) as never;
const OBJECT_ID = '11111111-1111-4111-8111-111111111111';

/** The text of a probe's eval'd body with every heredoc body removed: only the probe's own lines remain. */
function skeleton(stdin: string): string[] {
  const body = /eval "\$\(cat <<'(SK_EOF_\w+)'\n([\s\S]*)\n\1\n\)"/.exec(stdin)?.[2] ?? stdin;
  const lines: string[] = [];
  let until: string | null = null;
  for (const line of body.split('\n')) {
    if (until !== null) {
      if (line === until) until = null;
      continue;
    }
    lines.push(line);
    const heredoc = /<<'(SK_DRY_\w+)'/.exec(line);
    if (heredoc) until = heredoc[1]!;
  }
  return lines;
}

const ALLOWED_PROBE_LINES: RegExp[] = [
  /^$/,
  new RegExp(`^${PROBE_MARKER}`),
  /^rc=0$/,
  /^exit( \$rc|\s\$\?| 0| 1)?$/,
  /^if bash -n <<'SK_DRY_\w+'$/,
  /^if sh -n <<'SK_DRY_\w+'$/,
  /^then echo "syntax: ok"; else echo "syntax: error" >&2; rc=1; fi$/,
  /^SK_DRY_\w+$/,
  /^command -v -- '[^']+' >\/dev\/null 2>&1 && echo '.*' \|\| \{ echo '.*' >&2; rc=1; \}$/,
  /^[df]='[^']*'$/,
  /^if test -[dwe] "\$[df]"; then echo .*; else echo .*; fi$/,
  /^if test -e "\$f"; then echo .*; else echo .*; fi$/,
  /^ls -la -- \S+$/,
  /^DEBIAN_FRONTEND=noninteractive apt-get -s (upgrade|install --only-upgrade .+)$/,
  /^(dnf|yum) --assumeno upgrade.*$/,
  /^apk (upgrade --simulate|add --upgrade --simulate .+)$/,
  /^zypper --non-interactive update --dry-run.*$/,
];

describeWithDb('Runbook safety (real Postgres, real shell)', () => {
  let h: Harness;
  let servers: string[];
  let audit: RunbookAuditService;
  const scratch = mkdtempSync(join(tmpdir(), 'sk-safety-'));

  const create = (runbookId: string, extra: Record<string, unknown> = {}, userId = h.userA) =>
    h.runs.create(who(h, userId), runbookId, { params: {}, secretRefs: {}, targets: { serverIds: [servers[0]!, servers[1]!] }, ...extra } as never);
  const executions = (runId: string) =>
    runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookCommandExecution.findMany({ where: { step: { runId } }, orderBy: { startedAt: 'asc' } }));

  beforeAll(async () => {
    h = await createHarness('safety');
    servers = [await h.addServer('server-a'), await h.addServer('server-b'), await h.addServer('server-c')];
    audit = new RunbookAuditService(h.prisma, h.runs as RunbookRunsService, { readableWhere: async () => ({}) } as never);
  }, 180_000);

  afterAll(async () => {
    await h?.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  beforeEach(() => {
    h.settings.current = { ...h.settings.current, approvals: { ...h.settings.current.approvals, allowSelfApproval: false } };
  });

  // A destructive-classified line (`DROP TABLE` after a comment mark) that is harmless if it ever runs.
  const destructive = (marker: string) => cmd('d1', `touch ${marker} # DROP TABLE users`);

  describe('the destructive guard and the two-person rule', () => {
    it('refuses a destructive launch without confirm: 428 with the findings and the count', async () => {
      const marker = join(scratch, 'm-no-confirm');
      const { runbookId } = await h.addRunbook('guard-no-confirm', { schemaVersion: 1, steps: [destructive(marker)] } as never);
      const error = await create(runbookId).then(() => null, (e) => e);
      expect(error.getStatus()).toBe(428);
      expect(error.getResponse()).toMatchObject({
        code: 'RUNBOOK_CONFIRMATION_REQUIRED',
        details: { runbookName: 'guard-no-confirm', targetCount: 2, requiresApproval: true, findings: [{ stepId: 'd1', destructive: true }] },
      });
      await h.drain();
      expect(existsSync(marker)).toBe(false);
    });

    it('refuses a wrong server count or a wrong name', async () => {
      const { runbookId } = await h.addRunbook('guard-wrong', { schemaVersion: 1, steps: [destructive(join(scratch, 'm-wrong'))] } as never);
      for (const confirm of [
        { runbookName: 'guard-wrong', targetCount: 3 },
        { runbookName: 'Guard-wrong', targetCount: 2 },
        { runbookName: 'guard-wrong', targetCount: 0 },
      ]) {
        const error = await create(runbookId, { confirm }).then(() => null, (e) => e);
        expect(error.getStatus()).toBe(428);
      }
    });

    it('a correct confirm parks the run queued behind a destructive_run approval; another user approves and it runs', async () => {
      const marker = join(scratch, 'm-approved');
      const { runbookId } = await h.addRunbook('guard-approve', { schemaVersion: 1, steps: [destructive(marker)] } as never);
      const before = h.fixture.execs.length;
      const result = await create(runbookId, { confirm: { runbookName: 'guard-approve', targetCount: 2 } });
      expect(result).toMatchObject({ status: 'queued', awaitingApproval: true, dryRun: false });
      await h.drain();
      expect(h.fixture.execs.length).toBe(before); // nothing was sent
      const parked = (await h.snapshot(result.runId)).run;
      expect(parked).toMatchObject({ status: 'queued', destructive: true });
      expect(parked.targets).toHaveLength(0);

      const approval = await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookApproval.findFirstOrThrow({ where: { runId: result.runId } }));
      expect(approval).toMatchObject({ kind: 'destructive_run', status: 'pending', scope: 'run' });
      expect(h.notifications.notifyPermissionHolders).toHaveBeenCalled();

      // self-approval: 403
      await expect(h.approvals.decide(who(h), approval.id, 'approve')).rejects.toMatchObject({ response: { code: 'RUNBOOK_SELF_APPROVAL' } });
      await h.drain();
      expect(existsSync(marker)).toBe(false);

      await h.approvals.decide(who(h, h.userB), approval.id, 'approve');
      await h.drain({ until: async () => ['succeeded', 'failed'].includes((await h.snapshot(result.runId)).run.status) });
      expect((await h.snapshot(result.runId)).run.status).toBe('succeeded');
      expect(existsSync(marker)).toBe(true);
      expect(h.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'runbook_run.destructive_confirmed', targetId: result.runId }));
      expect(h.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'runbook_approval.decided', actorUserId: h.userB }));
    });

    it('a rejection cancels the run with APPROVAL_REJECTED and nothing ever ran', async () => {
      const marker = join(scratch, 'm-rejected');
      const { runbookId } = await h.addRunbook('guard-reject', { schemaVersion: 1, steps: [destructive(marker)] } as never);
      const before = h.fixture.execs.length;
      const { runId } = await create(runbookId, { confirm: { runbookName: 'guard-reject', targetCount: 2 } });
      const approval = await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookApproval.findFirstOrThrow({ where: { runId } }));
      await h.approvals.decide(who(h, h.userB), approval.id, 'reject', 'no');
      await h.drain();
      const { run } = await h.snapshot(runId);
      expect(run).toMatchObject({ status: 'cancelled', errorCode: 'APPROVAL_REJECTED' });
      expect(run.finishedAt).not.toBeNull();
      expect(h.fixture.execs.length).toBe(before);
      expect(existsSync(marker)).toBe(false);
    });

    it('cancelling a run that waits for its approval cancels it outright', async () => {
      const { runbookId } = await h.addRunbook('guard-cancel', { schemaVersion: 1, steps: [destructive(join(scratch, 'm-cancel'))] } as never);
      const { runId } = await create(runbookId, { confirm: { runbookName: 'guard-cancel', targetCount: 2 } });
      await h.runs.cancel(who(h), runId);
      const { run } = await h.snapshot(runId);
      expect(run.status).toBe('cancelled');
      const approval = await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookApproval.findFirstOrThrow({ where: { runId } }));
      expect(approval.status).toBe('expired');
    });

    it('with allowSelfApproval on, a confirmed destructive run starts at once (no approval row)', async () => {
      h.settings.current = { ...h.settings.current, approvals: { ...h.settings.current.approvals, allowSelfApproval: true } };
      const marker = join(scratch, 'm-self');
      const { runbookId } = await h.addRunbook('guard-self', { schemaVersion: 1, steps: [destructive(marker)] } as never);
      const result = await create(runbookId, { confirm: { runbookName: 'guard-self', targetCount: 2 } });
      expect(result.awaitingApproval).toBe(false);
      await h.drain({ until: async () => ['succeeded', 'failed'].includes((await h.snapshot(result.runId)).run.status) });
      expect((await h.snapshot(result.runId)).run.status).toBe('succeeded');
      const approvals = await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookApproval.count({ where: { runId: result.runId } }));
      expect(approvals).toBe(0);
    });

    it('a non-destructive runbook needs no confirmation', async () => {
      const { runbookId } = await h.addRunbook('guard-safe', { schemaVersion: 1, steps: [cmd('s', 'echo ok')] } as never);
      const result = await create(runbookId);
      expect(result.awaitingApproval).toBe(false);
      await h.drain();
    });

    it('a retry of a destructive run needs the confirmation too', async () => {
      h.settings.current = { ...h.settings.current, approvals: { ...h.settings.current.approvals, allowSelfApproval: true } };
      const { runbookId } = await h.addRunbook('guard-retry', { schemaVersion: 1, steps: [destructive(join(scratch, 'm-retry'))] } as never);
      const { runId } = await create(runbookId, { confirm: { runbookName: 'guard-retry', targetCount: 2 } });
      await h.drain({ until: async () => ['succeeded', 'failed'].includes((await h.snapshot(runId)).run.status) });
      const error = await h.runs.retry(who(h), runId, 'all').then(() => null, (e) => e);
      expect(error.getStatus()).toBe(428);
      const retried = await h.runs.retry(who(h), runId, 'all', { runbookName: 'guard-retry', targetCount: 2 });
      expect(retried.runId).toBeDefined();
      await h.drain();
    });
  });

  describe('dry run', () => {
    it('sends only read-only probes, changes nothing, marks steps and suppresses the finished event', async () => {
      const marker = join(scratch, 'dry-marker');
      const dir = join(scratch, 'dry-dir');
      const { runbookId } = await h.addRunbook('dry-everything', {
        schemaVersion: 1,
        steps: [
          cmd('c1', `touch ${marker} # DROP TABLE users`),
          cmd('c2', 'sk-no-such-binary-xyz --now', { continueOnError: true }),
          { id: 's1', name: 's1', kind: 'script', interpreter: 'bash', body: `touch ${marker}\necho done` },
          { id: 'p1', name: 'p1', kind: 'package_update', manager: 'apt', packages: 'all', continueOnError: true },
          { id: 'f1', name: 'f1', kind: 'file_upload', storageObjectId: OBJECT_ID, destPath: `${dir}/x.conf`, continueOnError: true },
          { id: 'l1', name: 'l1', kind: 'collect_logs', paths: ['/etc/host*'] },
          { id: 'g1', name: 'g1', kind: 'approval_gate' },
          { id: 'a1', name: 'a1', kind: 'ai_task', goal: 'tidy', approvalMode: 'per_command' },
        ],
        strategy: { pauseAfterFirstBatch: true, batchSize: 1, maxFailures: { percent: 100 } },
      } as never);
      const before = h.fixture.execs.length;
      const stdinsBefore = h.fixture.stdins.length;
      h.finishedEvents.length = 0;
      h.notifications.notify.mockClear();

      // A destructive runbook is rehearsed without a confirmation.
      const result = await create(runbookId, { dryRun: true });
      expect(result).toMatchObject({ dryRun: true, awaitingApproval: false });
      await h.drain({ until: async () => ['succeeded', 'failed', 'partially_failed'].includes((await h.snapshot(result.runId)).run.status) });

      const { run, steps } = await h.snapshot(result.runId);
      expect(run.dryRun).toBe(true);
      expect(['failed', 'partially_failed', 'succeeded']).toContain(run.status);
      expect(run.targets.every((t) => ['succeeded', 'failed'].includes(t.status))).toBe(true);
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(dir)).toBe(false);

      // The allowlist of what the fixture received.
      const execs = h.fixture.execs.slice(before);
      expect(execs.length).toBeGreaterThan(0);
      expect(new Set(execs)).toEqual(new Set(['bash -s']));
      const stdins = h.fixture.stdins.slice(stdinsBefore);
      for (const stdin of stdins) {
        for (const line of skeleton(stdin)) expect(ALLOWED_PROBE_LINES.some((re) => re.test(line))).toBe(true);
      }
      expect(stdins.every((stdin) => stdin.includes(PROBE_MARKER))).toBe(true);

      // Step statuses: succeeded (would run), failed (precondition), skipped.
      const first = run.targets[0]!;
      const byId = new Map(steps.filter((s) => s.runTargetId === first.id).map((s) => [s.stepId, s]));
      expect(byId.get('c1')!.status).toBe('succeeded');
      expect(byId.get('c2')!.status).toBe('failed');
      expect(byId.get('c2')!.errorCode).toBe('DRY_RUN_PRECONDITION');
      expect(byId.get('s1')!.status).toBe('succeeded');
      expect(byId.get('g1')!.status).toBe('skipped');
      expect(byId.get('a1')!.status).toBe('skipped');
      expect(byId.get('f1')!.status).toBe('failed'); // the directory does not exist
      expect(['succeeded', 'failed']).toContain(byId.get('l1')!.status);
      expect(byId.get('c1')!.outputTail).toContain('DRY RUN');

      // Every probe is a recorded execution, origin dry_run.
      const rows = await executions(result.runId);
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((r) => r.origin))).toEqual(new Set(['dry_run']));

      // No approvals (the canary pause is off and the gate is skipped), no finished event, in-app notice only.
      const approvals = await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookApproval.count({ where: { runId: result.runId } }));
      expect(approvals).toBe(0);
      expect(h.finishedEvents).toHaveLength(0);
      expect(h.notifications.notify).toHaveBeenCalledWith('runbooks.dry_run_finished', h.userA, expect.any(Object));
      expect(h.notifications.notify).not.toHaveBeenCalledWith('runbooks.run_finished', expect.anything(), expect.anything());
      expect(h.notifications.notify).not.toHaveBeenCalledWith('runbooks.run_failed', expect.anything(), expect.anything());
      expect(h.factsService.tryProbeClient).toHaveBeenCalled();
    });
  });

  describe('the audit trail', () => {
    it('lists the lifecycle and every command exactly once, in order, and exports CSV that escapes formulas', async () => {
      h.settings.current = { ...h.settings.current, approvals: { ...h.settings.current.approvals, allowSelfApproval: false } };
      const { runbookId } = await h.addRunbook('audit-scripted', {
        schemaVersion: 1,
        steps: [cmd('a1', 'echo one'), cmd('a2', '=1+1', { continueOnError: true }), cmd('a3', `echo three # DROP TABLE users`)],
      } as never);
      const { runId, approvalId } = await create(runbookId, { confirm: { runbookName: 'audit-scripted', targetCount: 2 } });
      await h.approvals.decide(who(h, h.userB), approvalId!, 'approve');
      await h.drain({ until: async () => ['succeeded', 'failed', 'partially_failed'].includes((await h.snapshot(runId)).run.status) });

      const trail = await audit.trail(who(h), runId, { page: 1, pageSize: 1000 });
      const rows = await executions(runId);
      const commands = trail.items.filter((i) => i.kind === 'command');
      expect(commands).toHaveLength(rows.length);
      expect(rows.length).toBe(6); // 3 steps x 2 servers, each exactly once
      expect(trail.total).toBe(trail.events + trail.commands);

      const times = trail.items.map((i) => i.at);
      expect([...times].sort()).toEqual(times);
      const events = trail.items.filter((i) => i.kind === 'event').map((i) => i.event);
      expect(events).toEqual(['run.created', 'approval.requested', 'run.destructive_confirmed', 'approval.decided', 'run.started', 'run.finished']);
      expect(trail.items[0]).toMatchObject({ event: 'run.created', userId: h.userA });
      const decided = trail.items.find((i) => i.event === 'approval.decided')!;
      expect(decided.userId).toBe(h.userB);
      for (const c of commands) {
        expect(c).toMatchObject({ userId: h.userA, approverUserId: h.userB, origin: 'step' });
        expect(c.commandSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(c.serverName).toMatch(/^server-[ab]$/);
      }

      const chunks: string[] = [];
      for await (const chunk of audit.exportChunks(who(h), runId, 'csv')) chunks.push(chunk);
      const csv = chunks.join('');
      expect(csv.split('\r\n')[0]).toContain('commandSha256');
      expect(csv).toContain("'=1+1"); // formula injection neutralised
      expect(csv).not.toMatch(/(^|,)=1\+1/m);
      expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1 + trail.total);

      const json: string[] = [];
      for await (const chunk of audit.exportChunks(who(h), runId, 'json')) json.push(chunk);
      expect(JSON.parse(json.join(''))).toHaveLength(trail.total);
    });

    it('answers "what ran on server X" across runs, filtered and paginated', async () => {
      const page = await audit.commands(who(h), { serverId: servers[0]!, page: 1, pageSize: 5 });
      expect(page.total).toBeGreaterThan(5);
      expect(page.items).toHaveLength(5);
      expect(page.items.every((i) => i.serverProfileId === servers[0])).toBe(true);
      const times = page.items.map((i) => i.at);
      expect([...times].sort().reverse()).toEqual(times);
      expect(page.items[0]).toMatchObject({ runbookName: expect.any(String), commandSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });

      const none = await audit.commands(who(h), { serverId: servers[2]!, page: 1, pageSize: 5 });
      expect(none.total).toBe(0);
      const future = await audit.commands(who(h), { from: new Date(Date.now() + 86_400_000), page: 1, pageSize: 5 });
      expect(future.total).toBe(0);
      const byUser = await audit.commands(who(h), { userId: h.userB, page: 1, pageSize: 5 });
      expect(byUser.total).toBe(0);
    });

    it('never stores a secret in a command preview', async () => {
      const secret = ['sentinel', 'secret', Math.random().toString(36).slice(2, 12)].join('-');
      h.secrets.set('tok', secret);
      const { runbookId } = await h.addRunbook('audit-secret', {
        schemaVersion: 1,
        parameters: [{ name: 'TOKEN', type: 'secret', required: true }],
        steps: [cmd('t', `echo "$TOKEN" >/dev/null; echo literal-${secret}`)],
      } as never);
      const { runId } = await h.runs.create(who(h), runbookId, { params: {}, secretRefs: { TOKEN: 'tok' }, targets: { serverIds: [servers[0]!] } } as never);
      await h.drain({ until: async () => ['succeeded', 'failed'].includes((await h.snapshot(runId)).run.status) });
      const chunks: string[] = [];
      for await (const chunk of audit.exportChunks(who(h), runId, 'json')) chunks.push(chunk);
      expect(chunks.join('')).not.toContain(secret);
    });
  });
});
