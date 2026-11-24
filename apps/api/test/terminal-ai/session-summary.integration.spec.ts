// =============================================================================
// Terminal session summaries (issue #59)
// =============================================================================
//
// The real controller, `SessionSummaryService`, `SessionSummarizeHandler`, `TerminalContextService` and
// `SessionHistoryService` over a scripted SSH exec, and the platform's real `AiService` over
// `FakeAiProvider`. The proof is the fake's own call log (what a model would receive), the queued
// job's payload, the stored row, the log lines and the audit events: a secret planted in the pane
// reaches none of them.
// =============================================================================

import { Logger, NotFoundException } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ZodValidationPipe } from 'nestjs-zod';
import { Test } from '@nestjs/testing';
import { AiEnabledGuard, AiOrgEnabledInterceptor, AiService } from '@marinoscar/platform-api/ai';
import {
  createAiRuntimeHarness,
  HARNESS_MODEL,
  HARNESS_ORG,
  HARNESS_USER,
  type AiRuntimeHarness,
} from '@marinoscar/platform-api/ai/testing';
import { AUDIT_SINK } from '@marinoscar/platform-api/core';
import { JobHandlerRegistry, JobsService, type Job } from '@marinoscar/platform-api/jobs';
import { SettingsResolver } from '@marinoscar/platform-api/settings';

import '../../src/app-registrations/ai';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SessionHistoryService } from '../../src/terminal/session-history.service';
import { SessionsService } from '../../src/terminal/sessions.service';
import { SessionSummarizeHandler } from '../../src/terminal-ai/jobs/session-summarize.handler';
import { SessionSummaryController } from '../../src/terminal-ai/session-summary.controller';
import { SessionSummaryService } from '../../src/terminal-ai/session-summary.service';
import { TerminalContextService } from '../../src/terminal-ai/terminal-context.service';
import { withoutAuthGuards } from '../helpers/allow-guards';
import { createFakeSummaryPrisma, type FakeSession } from './summary-fakes';

// Assembled at run time so no secret-shaped literal sits in the repository.
const AWS_KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const SESSION_ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const TERMINATED_ID = '4a1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const OTHER_SESSION_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OTHER_USER = '55555555-5555-4555-8555-555555555555';

const filler = (lines: number) => Array.from({ length: lines }, (_, i) => `PANE_LINE_${i} ${'o'.repeat(40)}`);
const SHORT_PANE = ['user@host:~$ env', `AWS_ACCESS_KEY_ID=${AWS_KEY}`, 'PANE_MARKER_LINE ok'].join('\n');
// ~150k characters with the secret in the middle: three 60k parts.
const LONG_PANE = [...filler(1500), `AWS_ACCESS_KEY_ID=${AWS_KEY}`, ...filler(1500)].join('\n');

const ANSWER = {
  summaryMd: `## What was done\nChecked the environment. The key ${AWS_KEY} was visible.`,
  commands: [
    { command: 'env', outcome: 'ok' },
    { command: `export AWS_ACCESS_KEY_ID=${AWS_KEY}`, outcome: 'unknown' },
  ],
};

describe('terminal session summaries', () => {
  let app: NestFastifyApplication;
  let harness: AiRuntimeHarness;
  let handler: SessionSummarizeHandler;
  let sessions: FakeSession[];
  let summaries: ReturnType<typeof createFakeSummaryPrisma>;
  let profile: { aiOutputSharing: boolean; facts: unknown };
  let consent: string | undefined;
  let pane: string;
  let exec: jest.Mock;
  let audit: jest.Mock;
  let queued: Array<Job & { done?: boolean }>;
  let enqueue: jest.Mock;
  let permissions: string[];
  let logged: string[];
  const spies: jest.SpyInstance[] = [];

  const baseSession = (id: string, over: Partial<FakeSession> = {}): FakeSession => ({
    id,
    userId: HARNESS_USER,
    orgId: HARNESS_ORG,
    status: 'active',
    serverProfileId: 'prof-1',
    ...over,
  });

  beforeEach(async () => {
    logged = [];
    for (const method of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
      spies.push(jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => void logged.push(JSON.stringify(args))));
    }
    permissions = ['ai:use', 'sessions:read'];
    sessions = [baseSession(SESSION_ID), baseSession(TERMINATED_ID, { status: 'terminated' }), baseSession(OTHER_SESSION_ID, { userId: OTHER_USER })];
    summaries = createFakeSummaryPrisma(() => sessions);
    pane = SHORT_PANE;
    consent = '2026-11-24T10:00:00.000Z';
    // The fake model: notes for a part of a long session, the structured answer for the final call.
    harness = createAiRuntimeHarness({
      fake: {
        responses: (req) =>
          JSON.stringify(req).includes('ONE PART of a long')
            ? { outputText: '- ran `env` (ok)' }
            : { outputText: JSON.stringify(ANSWER) },
      },
    });
    profile = {
      aiOutputSharing: true,
      facts: { kernel: 'Linux 6.1', os: 'linux', shell: '/bin/bash', prettyName: 'Distro X 1', packageManager: 'apt', has: ['tmux'] },
    };
    exec = jest.fn(async (_p: unknown, command: string) => (command.includes('display-message') ? '/srv/app\n' : pane));
    audit = jest.fn().mockResolvedValue(undefined);
    const findOne = jest.fn(async (id: string) => {
      const found = sessions.find((s) => s.id === id && s.userId === HARNESS_USER);
      if (!found) throw new NotFoundException('not found');
      return found;
    });
    const history = new SessionHistoryService(
      { findOne } as never,
      { execForOutput: exec } as never,
      { getDecryptedProfileForSession: jest.fn().mockResolvedValue({ id: 'prof-1' }) } as never,
    );

    // A queue with dedup: one active job per subject, like `jobs_active_dedup_uniq_idx`.
    queued = [];
    enqueue = jest.fn(async (input: { type: string; subjectId: string; payload: unknown; orgId: string }) => {
      const active = queued.find((j) => j.subjectId === input.subjectId && !j.done);
      if (active) return active;
      const job = {
        id: `00000000-0000-4000-9000-${String(queued.length + 1).padStart(12, '0')}`,
        type: input.type,
        subjectType: 'terminal_session',
        subjectId: input.subjectId,
        payload: input.payload,
        orgId: input.orgId,
        attempts: 1,
      } as unknown as Job;
      queued.push(job);
      return job;
    });

    const aiForTests = {
      // The harness has no `ai.defaultModel` user setting, which the feature relies on, so the
      // test names the harness model on the way through; everything else is the real facade.
      forUser: (userId: string, scope: Parameters<typeof harness.ai.forUser>[1]) => {
        const client = harness.ai.forUser(userId, scope);
        return {
          respond: (req: Parameters<typeof client.respond>[0], opts?: Parameters<typeof client.respond>[1]) =>
            client.respond({ ...req, model: HARNESS_MODEL }, opts),
          respondStructured: (req: Parameters<typeof client.respondStructured>[0], opts?: Parameters<typeof client.respondStructured>[1]) =>
            client.respondStructured({ ...req, model: HARNESS_MODEL } as never, opts),
        };
      },
    };

    const moduleRef = await withoutAuthGuards(
      Test.createTestingModule({
        controllers: [SessionSummaryController],
        providers: [
          SessionSummaryService,
          SessionSummarizeHandler,
          TerminalContextService,
          { provide: AiService, useValue: aiForTests },
          { provide: JobsService, useValue: { enqueue } },
          { provide: JobHandlerRegistry, useValue: { register: jest.fn() } },
          { provide: SessionsService, useValue: { findOne } },
          { provide: SessionHistoryService, useValue: history },
          {
            provide: PrismaService,
            useValue: { ...summaries.prisma, serverProfile: { findFirst: jest.fn(async () => profile) } },
          },
          {
            provide: SettingsResolver,
            useValue: {
              resolveSystem: async () => ({ redactionMode: 'standard', requireConsent: true }),
              resolveUser: async () => ({ consentAcceptedAt: consent }),
            },
          },
          { provide: AUDIT_SINK, useValue: { record: audit } },
        ],
      })
        .overrideGuard(AiEnabledGuard)
        .useValue({ canActivate: () => true })
        .overrideInterceptor(AiOrgEnabledInterceptor)
        .useValue({ intercept: (_c: unknown, next: { handle(): unknown }) => next.handle() }),
    ).compile();

    handler = moduleRef.get(SessionSummarizeHandler);
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ZodValidationPipe());
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRequest', (async (req: { requestUser?: unknown; user?: unknown }) => {
        req.user = { id: HARNESS_USER, activeOrgId: HARNESS_ORG };
        req.requestUser = { id: HARNESS_USER, activeOrgId: HARNESS_ORG, roles: [], permissions };
      }) as never);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    spies.splice(0).forEach((spy) => spy.mockRestore());
    await app.close();
  });

  const url = (id = SESSION_ID, tail = '') => `/api/ai/terminal/sessions/${id}/summaries${tail}`;
  const post = (id = SESSION_ID) => app.inject({ method: 'POST', url: url(id) });
  const get = (id = SESSION_ID, tail = '') => app.inject({ method: 'GET', url: url(id, tail) });
  const providerInput = () => JSON.stringify(harness.fake.calls.map((c) => c.request));
  const runQueued = async () => {
    for (const job of queued.filter((j) => !j.done)) {
      await handler.process(job);
      job.done = true;
    }
  };

  it('queues the job with ids only and answers 202 { summaryId, jobId }', async () => {
    const res = await post();
    expect(res.statusCode).toBe(202);
    const body = res.json() as { summaryId: string; jobId: string; status: string };
    expect(body.status).toBe('pending');
    expect(enqueue).toHaveBeenCalledTimes(1);
    const input = enqueue.mock.calls[0][0] as Record<string, unknown>;
    expect(input).toMatchObject({
      type: 'ai.session.summarize',
      subjectType: 'terminal_session',
      subjectId: SESSION_ID,
      orgId: HARNESS_ORG,
      payload: { summaryId: body.summaryId, sessionId: SESSION_ID, userId: HARNESS_USER, orgId: HARNESS_ORG },
    });
    expect(Object.keys(input.payload as object).sort()).toEqual(['orgId', 'sessionId', 'summaryId', 'userId']);
    // Nothing was read from the pane and nothing was sent to a model to answer the request.
    expect(exec).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('capture-pane'));
    expect(harness.fake.calls).toHaveLength(0);
  });

  it('answers the existing pending summary on a second POST (dedup)', async () => {
    const first = (await post()).json() as { summaryId: string; jobId: string };
    const second = await post();
    expect(second.statusCode).toBe(202);
    expect(second.json()).toMatchObject({ summaryId: first.summaryId, jobId: first.jobId, status: 'pending' });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(summaries.rows).toHaveLength(1);
  });

  it('collapses two simultaneous requests onto the job already queued', async () => {
    // The first request's row exists and its job is in flight, but this request did not see it as pending.
    summaries.rows.push({
      id: '00000000-0000-4000-8000-0000000000aa',
      sessionId: SESSION_ID,
      userId: HARNESS_USER,
      orgId: HARNESS_ORG,
      jobId: 'job-x',
      status: 'succeeded',
      summaryMd: null,
      commands: null,
      findings: null,
      sourceChars: null,
      truncated: false,
      model: null,
      errorCode: null,
      createdAt: new Date(Date.now() - 1000),
      completedAt: null,
    });
    queued.push({
      id: 'job-x',
      subjectId: SESSION_ID,
      payload: { summaryId: '00000000-0000-4000-8000-0000000000aa' },
    } as unknown as Job);
    const res = await post();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ summaryId: '00000000-0000-4000-8000-0000000000aa' });
    // This request's own row was removed: it will never be worked.
    expect(summaries.rows).toHaveLength(1);
  });

  it('summarizes a 150k-character capture in parts, with no secret anywhere it should not be', async () => {
    pane = LONG_PANE;
    expect(LONG_PANE.length).toBeGreaterThan(120_000);
    const { summaryId } = (await post()).json() as { summaryId: string };
    await runQueued();

    // map-reduce: one call per 60k part, then the final structured call.
    expect(harness.fake.callsTo('responses.create').length).toBeGreaterThanOrEqual(3);

    const res = await get(SESSION_ID, `/${summaryId}`);
    expect(res.statusCode).toBe(200);
    const row = res.json() as {
      status: string;
      summaryMd: string;
      commands: Array<{ command: string; outcome?: string }>;
      model: string;
      sourceChars: number;
      findings: Array<{ kind: string; count: number }>;
    };
    expect(row.status).toBe('succeeded');
    expect(row.commands.map((c) => c.command)[0]).toBe('env');
    expect(row.commands).toHaveLength(2);
    expect(row.model).toBeTruthy();
    expect(row.sourceChars).toBeGreaterThan(100_000);
    expect(row.findings.length).toBeGreaterThan(0);

    // The sentinel is nowhere: not in what the model got, the job payload, the stored row (the model
    // echoed it and the second redaction caught it), the response, the logs or the audit events.
    const everywhere = [
      providerInput(),
      JSON.stringify(queued.map((j) => j.payload)),
      JSON.stringify(summaries.rows),
      res.body,
      logged.join('\n'),
      JSON.stringify(audit.mock.calls),
    ];
    for (const text of everywhere) expect(text).not.toContain(AWS_KEY);
    // The logs carry counts, never summary text or pane text.
    expect(logged.join('\n')).not.toContain('PANE_LINE');
    expect(logged.join('\n')).not.toContain('What was done');
    expect(audit.mock.calls[0][0]).toMatchObject({ action: 'terminal_ai.request', meta: { feature: 'session_summary' } });
  });

  it('summarizes a short capture with one call', async () => {
    const { summaryId } = (await post()).json() as { summaryId: string };
    await runQueued();
    expect(harness.fake.callsTo('responses.create')).toHaveLength(1);
    expect(providerInput()).toContain('PANE_MARKER_LINE');
    expect(providerInput()).not.toContain(AWS_KEY);
    expect((await get(SESSION_ID, `/${summaryId}`)).json()).toMatchObject({ status: 'succeeded' });
  });

  it('lists the newest summaries first', async () => {
    const first = (await post()).json() as { summaryId: string };
    await runQueued();
    const second = (await post()).json() as { summaryId: string };
    const list = (await get()).json() as Array<{ id: string }>;
    expect(list.map((s) => s.id)).toEqual([second.summaryId, first.summaryId]);
  });

  it('answers 404 for another user’s session or summary, before any model call', async () => {
    expect((await post(OTHER_SESSION_ID)).statusCode).toBe(404);
    expect((await get(OTHER_SESSION_ID)).statusCode).toBe(404);
    const { summaryId } = (await post()).json() as { summaryId: string };
    expect((await get(OTHER_SESSION_ID, `/${summaryId}`)).statusCode).toBe(404);
    expect((await get(SESSION_ID, '/00000000-0000-4000-8000-0000000000ff')).statusCode).toBe(404);
    expect(harness.fake.calls).toHaveLength(0);
  });

  it('answers 409 AI_CONSENT_REQUIRED and AI_OUTPUT_SHARING_DISABLED before queuing anything', async () => {
    consent = undefined;
    const noConsent = await post();
    expect(noConsent.statusCode).toBe(409);
    expect(noConsent.json()).toMatchObject({ code: 'AI_CONSENT_REQUIRED' });

    consent = '2026-11-24T10:00:00.000Z';
    profile.aiOutputSharing = false;
    const noSharing = await post();
    expect(noSharing.statusCode).toBe(409);
    expect(noSharing.json()).toMatchObject({ code: 'AI_OUTPUT_SHARING_DISABLED' });

    expect(enqueue).not.toHaveBeenCalled();
    expect(summaries.rows).toHaveLength(0);
  });

  it('answers 400 for a terminated session and 403 without sessions:read', async () => {
    const ended = await post(TERMINATED_ID);
    expect(ended.statusCode).toBe(400);
    expect(ended.json()).toMatchObject({ code: 'SESSION_TERMINATED' });
    expect(enqueue).not.toHaveBeenCalled();

    permissions = ['ai:use'];
    expect((await post()).statusCode).toBe(403);
    expect((await get()).statusCode).toBe(403);
  });

  it('rejects a malformed id with 400', async () => {
    expect((await post('not-a-uuid')).statusCode).toBe(400);
  });

  it('checks the switch again when the job runs: a server turned off after queuing sends nothing', async () => {
    const { summaryId } = (await post()).json() as { summaryId: string };
    profile.aiOutputSharing = false;
    await runQueued();
    expect(harness.fake.calls).toHaveLength(0);
    expect(exec).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('capture-pane'));
    expect((await get(SESSION_ID, `/${summaryId}`)).json()).toMatchObject({ status: 'failed', errorCode: 'AI_OUTPUT_SHARING_DISABLED' });
  });

  it('checks consent again when the job runs', async () => {
    const { summaryId } = (await post()).json() as { summaryId: string };
    consent = undefined;
    await runQueued();
    expect(harness.fake.calls).toHaveLength(0);
    expect((await get(SESSION_ID, `/${summaryId}`)).json()).toMatchObject({ status: 'failed', errorCode: 'AI_CONSENT_REQUIRED' });
  });

  it('fails the row when the session was terminated after queuing', async () => {
    const { summaryId } = (await post()).json() as { summaryId: string };
    sessions.find((s) => s.id === SESSION_ID)!.status = 'terminated';
    await runQueued();
    expect(harness.fake.calls).toHaveLength(0);
    expect(summaries.rows.find((r) => r.id === summaryId)).toMatchObject({ status: 'failed', errorCode: 'SESSION_TERMINATED' });
  });

  it('fails an abandoned pending summary instead of leaving it pending forever', async () => {
    const { summaryId } = (await post()).json() as { summaryId: string };
    summaries.rows.find((r) => r.id === summaryId)!.createdAt = new Date(Date.now() - 2 * 60 * 60_000);
    expect((await get(SESSION_ID, `/${summaryId}`)).json()).toMatchObject({ status: 'failed', errorCode: 'SUMMARY_TIMED_OUT' });
    // The abandoned job has ended; a new request is allowed again.
    queued.forEach((j) => (j.done = true));
    expect((await post()).statusCode).toBe(202);
    expect(summaries.rows).toHaveLength(2);
  });
});
