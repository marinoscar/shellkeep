// =============================================================================
// Runbook schedules over a real database and a real shell (issue #66)
// =============================================================================
//
// The tick is driven with an INJECTED clock (`tick(now)`): no test waits for a real minute. Proves, with real
// Postgres under an ordinary role (forced row-level security):
//
//   - a schedule fires within 60 s of its slot, once, and moves to the next slot;
//   - two ticks racing for the same slot create ONE run (the guarded claim);
//   - `overlap: skip` skips while the previous run is active, `allow` does not;
//   - a missed slot is not caught up; Europe/Berlin fires at the right local time across a DST change;
//   - a revoked permission switches the schedule off and notifies its owner;
//   - a destructive runbook: confirmation, second-person approval, re-approval of a new version;
//   - the finished notifications and the webhook follow the commit; the webhook is signed and holds no secret.
// =============================================================================

import '../../src/shellkeep.manifest';
import '../../src/app-registrations/registrations';

import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { runInOrg } from '@marinoscar/platform-api/core';
import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';
import { createWebhooksTestKit, makeWebhookOwner } from '@marinoscar/platform-api/webhooks/testing';
import { verifyWebhookSignature } from '@marinoscar/platform-contract/webhooks';

import { EngineMetricsService } from '../../src/runbooks/engine/engine-metrics.service';
import { RunEventsService } from '../../src/runbooks/engine/run-events.service';
import { RunLifecycleService } from '../../src/runbooks/engine/run-lifecycle.service';
import { RunbookSchedulesService } from '../../src/runbooks/schedules/runbook-schedules.service';
import { RunbookSchedulesTickHandler } from '../../src/runbooks/schedules/runbook-schedules-tick.handler';
import { RunbookRiskService } from '../../src/runbooks/safety/runbook-risk.service';
import { RunbookWebhooksService } from '../../src/runbooks/webhooks/runbook-webhooks.service';
import { runbookRunCompletedSchema } from '../../src/runbooks/webhooks/runbooks.webhooks';
import { resolveDbSuite } from '../helpers/db-test-support';
import { createHarness, ORG_A, type Harness } from './engine-harness';

const { describeWithDb } = resolveDbSuite('runbook-schedules.db.spec');

const cmd = (id: string, command: string) => ({ id, name: id, kind: 'command', command });
const RUN_PERMS = ['runbooks:read', 'runbooks:write', 'runbooks:run', 'servers:read'];
const SECRET_SENTINEL = 'sk-sentinel-never-in-a-payload';

describeWithDb('Runbook schedules (real Postgres, real shell)', () => {
  let h: Harness;
  let server: string;
  let perms: string[];
  let schedules: RunbookSchedulesService;
  let tick: RunbookSchedulesTickHandler;

  const who = (userId = h.userA, permissions: string[] = [...RUN_PERMS, 'runbooks:approve']) =>
    ({ userId, activeOrgId: ORG_A, permissions }) as never;

  const create = (runbookId: string, extra: Record<string, unknown> = {}, userId = h.userA) =>
    schedules.create(who(userId), runbookId, {
      name: 'Nightly',
      cron: '*/5 * * * *',
      timezone: 'UTC',
      versionPin: 'latest',
      params: {},
      secretRefs: {},
      targets: { serverIds: [server] },
      overlap: 'skip',
      enabled: true,
      ...extra,
    } as never);

  const runsOf = (scheduleId: string) =>
    runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookRun.findMany({ where: { scheduleId }, orderBy: { createdAt: 'asc' } }));
  const rowOf = (scheduleId: string) =>
    runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookSchedule.findUniqueOrThrow({ where: { id: scheduleId } }));
  const setNext = (scheduleId: string, nextRunAt: Date) =>
    runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookSchedule.update({ where: { id: scheduleId }, data: { nextRunAt } }));
  const addVersion = (runbookId: string, version: number, definition: unknown) =>
    runInOrg(h.prisma, { orgId: ORG_A }, async (tx) => {
      const row = await tx.runbookVersion.create({
        data: { orgId: ORG_A, runbookId, version, definition: definition as never, definitionSha256: randomUUID().replace(/-/g, '').padEnd(64, '0') },
      });
      await tx.runbook.update({ where: { id: runbookId }, data: { latestVersionId: row.id } });
    });
  const finished = async (runId: string) => {
    await h.drain({ until: async () => ['succeeded', 'failed', 'partially_failed'].includes((await h.snapshot(runId)).run.status) });
    return (await h.snapshot(runId)).run;
  };

  beforeAll(async () => {
    h = await createHarness('schedules');
    server = await h.addServer('server-a');
    const access = {
      load: jest.fn(async (userId: string, orgId: string) => ({ principal: { userId, activeOrgId: orgId, permissions: perms }, scope: { userId, orgId } })),
      canRun: (initiator: { principal: { permissions: string[] } }) => initiator.principal.permissions.includes('runbooks:run'),
      requireRun: jest.fn(async () => undefined),
    };
    const runbooksFake = { requireRun: async () => undefined, requireRead: async () => undefined };
    const settingsFake = { effective: async () => h.settings.current };
    const credentials = { describe: async () => ({ name: 'x' }) };
    const metrics = new EngineMetricsService();
    schedules = new RunbookSchedulesService(h.prisma, runbooksFake as never, h.runs, settingsFake as never, credentials as never, new RunbookRiskService(), metrics, h.audit as never);
    tick = new RunbookSchedulesTickHandler(new JobHandlerRegistry(), h.prisma, h.system, access as never, h.runs, schedules, h.notifications as never, metrics);
  }, 180_000);

  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    // Every test starts with no schedule, so a tick only sees what the test made.
    await runInOrg(h.prisma, { orgId: ORG_A }, async (tx) => {
      await tx.runbookRun.updateMany({ where: { scheduleId: { not: null } }, data: { scheduleId: null } });
      await tx.runbookSchedule.deleteMany({});
    });
    perms = [...RUN_PERMS];
    h.notifications.notify.mockClear();
    h.settings.current = { ...h.settings.current, approvals: { ...h.settings.current.approvals, allowSelfApproval: false } };
  });

  describe('firing', () => {
    it('fires within 60 s of its slot, once, as the creator, and moves to the next slot', async () => {
      const { runbookId } = await h.addRunbook('fires', { schemaVersion: 1, steps: [cmd('s1', 'echo hi')] } as never);
      const created = await create(runbookId);
      const slot = created.nextRunAt!;
      expect(slot.getUTCMinutes() % 5).toBe(0);

      expect((await tick.tick(new Date(slot.getTime() - 1000))).due).toBe(0); // not yet
      const result = await tick.tick(new Date(slot.getTime() + 3000)); // 3 s late: inside the minute
      expect(result).toMatchObject({ due: 1, fired: 1, raced: 0 });

      const runs = await runsOf(created.id);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ trigger: 'schedule', initiatedBy: h.userA, scheduleId: created.id, status: 'queued' });
      const row = await rowOf(created.id);
      expect(row.lastRunId).toBe(runs[0]!.id);
      expect(row.nextRunAt!.getTime()).toBe(slot.getTime() + 5 * 60_000);

      await tick.tick(new Date(slot.getTime() + 4000)); // the same slot again: nothing
      expect(await runsOf(created.id)).toHaveLength(1);
      expect((await finished(runs[0]!.id)).status).toBe('succeeded');
    });

    it('two concurrent ticks create ONE run', async () => {
      const { runbookId } = await h.addRunbook('concurrent', { schemaVersion: 1, steps: [cmd('s1', 'true')] } as never);
      const created = await create(runbookId);
      const now = new Date(created.nextRunAt!.getTime() + 1000);
      const results = await Promise.all([tick.tick(now), tick.tick(now)]);
      expect(results.reduce((n, r) => n + r.fired, 0)).toBe(1);
      expect(results.reduce((n, r) => n + r.raced, 0)).toBe(1);
      expect(await runsOf(created.id)).toHaveLength(1);
    });

    it('overlap skip skips while the previous run is active; allow does not', async () => {
      const { runbookId } = await h.addRunbook('overlap', { schemaVersion: 1, steps: [cmd('s1', 'true')] } as never);
      const skip = await create(runbookId, { name: 'skip', overlap: 'skip' });
      const allow = await create(runbookId, { name: 'allow', overlap: 'allow' });
      const first = new Date(skip.nextRunAt!.getTime() + 1000);
      await tick.tick(first); // both fire; their runs stay queued (nothing drains them)
      const second = new Date(first.getTime() + 5 * 60_000);
      const result = await tick.tick(second);
      expect(result).toMatchObject({ fired: 1, skippedOverlap: 1 });
      expect(await runsOf(skip.id)).toHaveLength(1);
      expect(await runsOf(allow.id)).toHaveLength(2);
      expect((await rowOf(skip.id)).nextRunAt!.getTime()).toBeGreaterThan(second.getTime()); // the slot was consumed

      await h.drain({ until: async () => (await runsOf(skip.id)).every((r) => r.finishedAt !== null) });
      const third = new Date(second.getTime() + 5 * 60_000);
      expect((await tick.tick(third)).fired).toBe(2); // the previous run finished: skip fires again
      expect(await runsOf(skip.id)).toHaveLength(2);
    });

    it('does not catch up missed slots: after downtime it fires once and sets only the next future slot', async () => {
      const { runbookId } = await h.addRunbook('missed', { schemaVersion: 1, steps: [cmd('s1', 'true')] } as never);
      const created = await create(runbookId, { cron: '0 * * * *' });
      const now = new Date('2026-06-01T12:30:00.000Z');
      await setNext(created.id, new Date('2026-06-01T03:00:00.000Z')); // nine missed hourly slots
      expect((await tick.tick(now)).fired).toBe(1);
      expect(await runsOf(created.id)).toHaveLength(1);
      expect((await rowOf(created.id)).nextRunAt!.toISOString()).toBe('2026-06-01T13:00:00.000Z');
    });

    it('fires at 03:00 Europe/Berlin local time across the spring DST change', async () => {
      const { runbookId } = await h.addRunbook('berlin', { schemaVersion: 1, steps: [cmd('s1', 'true')] } as never);
      const created = await create(runbookId, { cron: '0 3 * * *', timezone: 'Europe/Berlin', overlap: 'allow' });
      // Winter: 03:00 CET is 02:00Z. Summer: 03:00 CEST is 01:00Z.
      await setNext(created.id, new Date('2026-03-28T02:00:00.000Z'));
      await tick.tick(new Date('2026-03-28T02:00:20.000Z'));
      expect((await rowOf(created.id)).nextRunAt!.toISOString()).toBe('2026-03-29T01:00:00.000Z');
      expect((await tick.tick(new Date('2026-03-29T00:59:59.000Z'))).due).toBe(0);
      await tick.tick(new Date('2026-03-29T01:00:20.000Z'));
      expect((await rowOf(created.id)).nextRunAt!.toISOString()).toBe('2026-03-30T01:00:00.000Z');
      expect(await runsOf(created.id)).toHaveLength(2);
    });
  });

  describe('permissions', () => {
    it('a revoked permission switches the schedule off, creates no run and notifies its owner', async () => {
      const { runbookId } = await h.addRunbook('revoked', { schemaVersion: 1, steps: [cmd('s1', 'true')] } as never);
      const created = await create(runbookId);
      perms = ['runbooks:read']; // runbooks:run was taken away
      const result = await tick.tick(new Date(created.nextRunAt!.getTime() + 1000));
      expect(result).toMatchObject({ disabled: 1, fired: 0 });
      expect(await runsOf(created.id)).toHaveLength(0);
      const row = await rowOf(created.id);
      expect(row).toMatchObject({ enabled: false, disabledReason: 'PERMISSION_REVOKED', nextRunAt: null });
      expect(h.notifications.notify).toHaveBeenCalledWith('runbooks.schedule_disabled', h.userA, expect.objectContaining({ reason: 'PERMISSION_REVOKED', scheduleName: 'Nightly' }));
    });

    it('losing servers:read does the same', async () => {
      const { runbookId } = await h.addRunbook('revoked-servers', { schemaVersion: 1, steps: [cmd('s1', 'true')] } as never);
      const created = await create(runbookId);
      perms = ['runbooks:read', 'runbooks:run'];
      expect((await tick.tick(new Date(created.nextRunAt!.getTime() + 1000))).disabled).toBe(1);
    });
  });

  describe('a destructive runbook', () => {
    const destructiveDef = (marker: string) => ({ schemaVersion: 1, steps: [cmd('d1', `touch ${marker} # DROP TABLE users`)] }) as never;

    it('needs the confirmation, then a second person, and fires only after that', async () => {
      const { runbookId } = await h.addRunbook('destructive', destructiveDef('/tmp/sk-sched-marker-1'));
      const refused = await create(runbookId).then(() => null, (e) => e);
      expect(refused.getStatus()).toBe(428);

      const created = await create(runbookId, { confirm: { runbookName: 'destructive', targetCount: 1 } });
      expect(created).toMatchObject({ enabled: false, disabledReason: 'APPROVAL_REQUIRED', nextRunAt: null, destructive: true, approval: { state: 'pending' } });
      await expect(schedules.update(who(), runbookId, created.id, { enabled: true } as never)).rejects.toMatchObject({
        response: { code: 'RUNBOOK_SCHEDULE_APPROVAL_REQUIRED' },
      });
      await expect(schedules.runNow(who(), runbookId, created.id)).rejects.toMatchObject({ response: { code: 'RUNBOOK_SCHEDULE_APPROVAL_REQUIRED' } });
      await expect(schedules.approve(who(), runbookId, created.id, {})).rejects.toMatchObject({ response: { code: 'RUNBOOK_SCHEDULE_SELF_APPROVAL' } });

      const approved = await schedules.approve(who(h.userB), runbookId, created.id, {});
      expect(approved).toMatchObject({ enabled: true, disabledReason: null, approval: { state: 'approved', approvedBy: h.userB, approvedVersion: 1 } });
      expect(approved.nextRunAt).not.toBeNull();

      const result = await tick.tick(new Date(approved.nextRunAt!.getTime() + 1000));
      expect(result.fired).toBe(1);
      const [run] = await runsOf(created.id);
      expect(run).toMatchObject({ destructive: true, trigger: 'schedule', status: 'queued' }); // not parked behind a per-run approval
      expect(await runInOrg(h.prisma, { orgId: ORG_A }, (tx) => tx.runbookApproval.count({ where: { runId: run!.id } }))).toBe(0);
    });

    it('a new destructive version under latest re-requires approval: the tick switches the schedule off', async () => {
      const { runbookId } = await h.addRunbook('destructive-latest', destructiveDef('/tmp/sk-sched-marker-2'));
      const created = await create(runbookId, { confirm: { runbookName: 'destructive-latest', targetCount: 1 } });
      const approved = await schedules.approve(who(h.userB), runbookId, created.id, {});
      await addVersion(runbookId, 2, destructiveDef('/tmp/sk-sched-marker-3'));
      const result = await tick.tick(new Date(approved.nextRunAt!.getTime() + 1000));
      expect(result).toMatchObject({ disabled: 1, fired: 0 });
      expect(await rowOf(created.id)).toMatchObject({ enabled: false, disabledReason: 'APPROVAL_REQUIRED' });
      expect(h.notifications.notify).toHaveBeenCalledWith('runbooks.schedule_disabled', h.userA, expect.objectContaining({ reason: 'APPROVAL_REQUIRED' }));
      // approving again, for version 2, turns it back on
      const again = await schedules.approve(who(h.userB), runbookId, created.id, {});
      expect(again).toMatchObject({ enabled: true, approval: { state: 'approved', approvedVersion: 2 } });
    });

    it('with self-approval on, the confirmation is the approval', async () => {
      h.settings.current = { ...h.settings.current, approvals: { ...h.settings.current.approvals, allowSelfApproval: true } };
      const { runbookId } = await h.addRunbook('destructive-self', destructiveDef('/tmp/sk-sched-marker-4'));
      const created = await create(runbookId, { confirm: { runbookName: 'destructive-self', targetCount: 1 } });
      expect(created).toMatchObject({ enabled: true, approval: { state: 'approved', approvedBy: h.userA } });
    });

    it('changing the targets of an approved destructive schedule needs the confirmation and a new approval', async () => {
      const { runbookId } = await h.addRunbook('destructive-edit', destructiveDef('/tmp/sk-sched-marker-5'));
      const created = await create(runbookId, { confirm: { runbookName: 'destructive-edit', targetCount: 1 } });
      await schedules.approve(who(h.userB), runbookId, created.id, {});
      const noConfirm = await schedules.update(who(), runbookId, created.id, { params: {} } as never).then(() => null, (e) => e);
      expect(noConfirm.getStatus()).toBe(428);
      const edited = await schedules.update(who(), runbookId, created.id, { targets: { serverIds: [server] }, confirm: { runbookName: 'destructive-edit', targetCount: 1 } } as never);
      expect(edited).toMatchObject({ enabled: false, disabledReason: 'APPROVAL_REQUIRED', approval: { state: 'pending' } });
    });
  });

  describe('notifications and webhooks', () => {
    it('notifies after the run is committed as finished, with the right key per status', async () => {
      const ok = await h.addRunbook('notify-ok', { schemaVersion: 1, steps: [cmd('s1', 'true')] } as never);
      const bad = await h.addRunbook('notify-bad', { schemaVersion: 1, steps: [cmd('s1', 'exit 3')] } as never);
      const okSchedule = await create(ok.runbookId, { name: 'ok' });
      const badSchedule = await create(bad.runbookId, { name: 'bad' });

      let seenWhenNotified: string | null = null;
      h.notifications.notify.mockImplementation(async (event: string) => {
        if (event === 'runbooks.run_finished') {
          const run = (await runsOf(okSchedule.id))[0]!;
          seenWhenNotified = (await h.snapshot(run.id)).run.status;
        }
      });
      await tick.tick(new Date(okSchedule.nextRunAt!.getTime() + 1000));
      const [okRun] = await runsOf(okSchedule.id);
      const [badRun] = await runsOf(badSchedule.id);
      await finished(okRun!.id);
      await finished(badRun!.id);

      expect(seenWhenNotified).toBe('succeeded'); // the notification came after the commit
      expect(h.notifications.notify).toHaveBeenCalledWith('runbooks.run_finished', h.userA, expect.objectContaining({ targetsTotal: 1, runLink: `/runbooks/runs/${okRun!.id}` }));
      expect(h.notifications.notify).toHaveBeenCalledWith('runbooks.run_failed', h.userA, expect.any(Object));
      h.notifications.notify.mockImplementation(async () => undefined);
    });

    it('a run-now by someone else also notifies the schedule owner', async () => {
      const { runbookId } = await h.addRunbook('notify-owner', { schemaVersion: 1, steps: [cmd('s1', 'true')] } as never);
      const created = await create(runbookId);
      const launched = await schedules.runNow(who(h.userB), runbookId, created.id);
      await finished(launched.runId);
      const calls = h.notifications.notify.mock.calls.filter((c) => c[0] === 'runbooks.run_finished').map((c) => c[1]);
      expect(calls.sort()).toEqual([h.userA, h.userB].sort());
      // run-now does not move the slot
      expect((await rowOf(created.id)).nextRunAt!.getTime()).toBe(created.nextRunAt!.getTime());
    });

    it('delivers runbook.run.completed to a subscribed org endpoint, signed, with metadata only', async () => {
      const kit = createWebhooksTestKit();
      kit.repository.setOwner(makeWebhookOwner({ id: h.userA, orgId: ORG_A, permissions: ['org_webhooks:read', 'org_webhooks:write', 'runbooks:read'] }));
      const { endpoint, secret } = await kit.seedEndpoint({ scope: 'org', orgId: ORG_A, ownerUserId: h.userA, eventKeys: ['runbook.run.completed'] });

      // The lifecycle with the webhook service wired, exactly as the module does.
      const webhooks = new RunbookWebhooksService(kit.webhooks, h.prisma, { get: () => 'https://app.example.test' } as never);
      const lifecycle = new RunLifecycleService(new RunEventsService(h.bus), new EventEmitter2(), h.notifications as never, h.prisma, new EngineMetricsService(), webhooks);
      const { runbookId } = await h.addRunbook('webhook-run', { schemaVersion: 1, steps: [cmd('s1', `echo ${SECRET_SENTINEL}`)] } as never);
      const created = await create(runbookId, { name: 'hook' });
      await tick.tick(new Date(created.nextRunAt!.getTime() + 1000));
      const [run] = await runsOf(created.id);
      await finished(run!.id);
      const snapshot = (await h.snapshot(run!.id)).run;
      const warn = jest.spyOn(Logger.prototype, 'warn');
      await lifecycle.afterCommit({
        runId: run!.id,
        events: [],
        cancelRequests: [],
        approvals: [],
        dispatched: 0,
        finished: {
          runId: run!.id,
          orgId: ORG_A,
          runbookId,
          version: 1,
          status: snapshot.status,
          trigger: 'schedule',
          initiatedBy: h.userA,
          dryRun: false,
          targetsTotal: 1,
          targetsSucceeded: 1,
          targetsFailed: 0,
        } as never,
      });

      expect(warn.mock.calls).toEqual([]);
      warn.mockRestore();
      const deliveries = [...kit.repository.deliveries.values()].filter((d) => d.endpointId === endpoint.id);
      expect(deliveries).toHaveLength(1);
      await kit.runDeliveryJob(deliveries[0]!.id, ORG_A);
      expect(kit.receiver.requests).toHaveLength(1);
      const request = kit.receiver.requests[0]!;
      expect(
        await verifyWebhookSignature({
          secret,
          id: request.headers['webhook-id'],
          timestamp: request.headers['webhook-timestamp'],
          body: request.body,
          signatureHeader: request.headers['webhook-signature'],
        }),
      ).toBe(true);
      const body = JSON.parse(request.body);
      expect(body.type).toBe('runbook.run.completed');
      expect(runbookRunCompletedSchema.safeParse(body.data).success).toBe(true);
      expect(body.data).toMatchObject({
        runId: run!.id,
        runbookName: 'webhook-run',
        status: 'succeeded',
        trigger: 'schedule',
        scheduleId: created.id,
        counts: { total: 1, succeeded: 1, failed: 0, cancelled: 0, skipped: 0 },
        url: `https://app.example.test/runbooks/runs/${run!.id}`,
      });
      // metadata only: no command, no output, no secret
      expect(request.body).not.toContain(SECRET_SENTINEL);
      expect(request.body).not.toContain('echo ');
      expect(request.body).not.toContain(secret);
    });

    it('a dry run never raises the completed event', async () => {
      const emitted: unknown[] = [];
      const webhooks = new RunbookWebhooksService({ emit: async (...args: unknown[]) => emitted.push(args) } as never, h.prisma);
      const { runbookId } = await h.addRunbook('webhook-dry', { schemaVersion: 1, steps: [cmd('s1', 'true')] } as never);
      const dry = await h.runs.create(who(), runbookId, { dryRun: true, params: {}, secretRefs: {}, targets: { serverIds: [server] } } as never);
      await finished(dry.runId);
      await webhooks.runCompleted({ runId: dry.runId, orgId: ORG_A });
      expect(emitted).toHaveLength(0);
    });
  });

  describe('deleting a schedule', () => {
    it('keeps its runs, detached', async () => {
      const { runbookId } = await h.addRunbook('delete', { schemaVersion: 1, steps: [cmd('s1', 'true')] } as never);
      const created = await create(runbookId);
      await tick.tick(new Date(created.nextRunAt!.getTime() + 1000));
      const [run] = await runsOf(created.id);
      await schedules.remove(who(), runbookId, created.id);
      const kept = await h.snapshot(run!.id);
      expect(kept.run.scheduleId).toBeNull();
      await expect(schedules.get(who(), runbookId, created.id)).rejects.toMatchObject({ status: 404 });
    });
  });
});
