// The handler against the platform's job-handler conformance kit (#59): the static contract
// (a dotted type, a label, a two-number profile, an `ai.*` type with neither node member), a settle
// through the fake queue, a double run, a failure by throwing, dedup.

import { AiError } from '@marinoscar/platform-api/ai';
import { describeJobHandlerConformance } from '@marinoscar/platform-api/jobs/testing';

import { createFakeSummaryPrisma, type FakeSession } from '../../../test/terminal-ai/summary-fakes';
import { SessionSummarizeHandler, SESSION_SUMMARIZE_TYPE } from './session-summarize.handler';

const SESSION_ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '33333333-3333-4333-8333-333333333333';
const SUMMARY_ID = '00000000-0000-4000-8000-000000000001';

type AiMode = 'ok' | 'disabled' | 'rate_limited';

const world: { mode: AiMode; sessions: FakeSession[]; fake: ReturnType<typeof createFakeSummaryPrisma> } = {
  mode: 'ok',
  sessions: [],
  fake: createFakeSummaryPrisma(() => world.sessions),
};

const arrange = (mode: AiMode) => () => {
  world.mode = mode;
  world.sessions = [{ id: SESSION_ID, userId: USER_ID, orgId: ORG_ID, status: 'active', serverProfileId: 'prof-1' }];
  world.fake = createFakeSummaryPrisma(() => world.sessions);
  world.fake.rows.push({
    id: SUMMARY_ID,
    sessionId: SESSION_ID,
    userId: USER_ID,
    orgId: ORG_ID,
    jobId: null,
    status: 'pending',
    summaryMd: null,
    commands: null,
    findings: null,
    sourceChars: null,
    truncated: false,
    model: null,
    errorCode: null,
    createdAt: new Date('2026-11-24T10:00:00Z'),
    completedAt: null,
  });
};

const ai = {
  forUser: () => ({
    respond: async () => ({ outputText: 'notes' }),
    respondStructured: async () => {
      if (world.mode === 'disabled') throw new AiError('AI_DISABLED', 'AI is off');
      if (world.mode === 'rate_limited') throw new AiError('AI_RATE_LIMITED', 'Slow down', { retryAfterMs: 1000 });
      return { parsed: { summaryMd: 'Did things.', commands: [{ command: 'ls', outcome: 'ok' }] }, model: 'fake-model' };
    },
  }),
};

const context = {
  forAi: async () => ({ text: 'user@host:~$ ls\nfile', findings: [], truncated: false, sharing: 'full' }),
};

const build = () =>
  new SessionSummarizeHandler(
    { register: () => undefined } as never,
    {
      terminalSessionSummary: world.fake.prisma.terminalSessionSummary,
      terminalSession: world.fake.prisma.terminalSession,
    } as never,
    context as never,
    ai as never,
  );

const payload = { summaryId: SUMMARY_ID, sessionId: SESSION_ID, userId: USER_ID, orgId: ORG_ID };
const snapshot = () => world.fake.rows.map((r) => ({ status: r.status, errorCode: r.errorCode, summaryMd: r.summaryMd }));

describeJobHandlerConformance(SESSION_SUMMARIZE_TYPE, build, {
  payloads: [
    {
      name: 'a session summary',
      payload,
      subjectType: 'terminal_session',
      subjectId: SESSION_ID,
      orgId: ORG_ID,
      arrange: arrange('ok'),
      observe: snapshot,
    },
    {
      // A condition no retry can fix: the row fails and the job ends cleanly.
      name: 'AI disabled',
      payload,
      subjectType: 'terminal_session',
      subjectId: SESSION_ID,
      orgId: ORG_ID,
      arrange: arrange('disabled'),
      observe: snapshot,
    },
    {
      // A provider throttle is thrown as a rate-limit error so the queue defers the job.
      name: 'rate limited',
      payload,
      subjectType: 'terminal_session',
      subjectId: SESSION_ID,
      orgId: ORG_ID,
      arrange: arrange('rate_limited'),
      expectFailure: true,
    },
    {
      name: 'a payload that is not ours',
      payload: { summaryId: 'nope' },
      expectFailure: 'Invalid ai.session.summarize payload',
    },
  ],
});

describe('SessionSummarizeHandler outcomes', () => {
  it('stores the summary on success and the failure code on AI disabled', async () => {
    arrange('ok')();
    await build().process({ id: 'j1', type: SESSION_SUMMARIZE_TYPE, payload, attempts: 1 } as never);
    expect(world.fake.rows[0]).toMatchObject({ status: 'succeeded', summaryMd: 'Did things.', model: 'fake-model' });

    arrange('disabled')();
    await build().process({ id: 'j2', type: SESSION_SUMMARIZE_TYPE, payload, attempts: 1 } as never);
    expect(world.fake.rows[0]).toMatchObject({ status: 'failed', errorCode: 'AI_DISABLED' });
  });

  it('leaves the row pending when rate limited, so the deferred job can finish it', async () => {
    arrange('rate_limited')();
    await expect(
      build().process({ id: 'j3', type: SESSION_SUMMARIZE_TYPE, payload, attempts: 1 } as never),
    ).rejects.toThrow();
    expect(world.fake.rows[0]).toMatchObject({ status: 'pending' });
  });

  it('marks the row failed on the last attempt of an error a retry could have fixed', async () => {
    arrange('ok')();
    const handler = new SessionSummarizeHandler(
      { register: () => undefined } as never,
      { terminalSessionSummary: world.fake.prisma.terminalSessionSummary, terminalSession: world.fake.prisma.terminalSession } as never,
      { forAi: async () => { throw new Error('ssh down'); } } as never,
      ai as never,
    );
    await expect(handler.process({ id: 'j4', type: SESSION_SUMMARIZE_TYPE, payload, attempts: 1 } as never)).rejects.toThrow('ssh down');
    expect(world.fake.rows[0]).toMatchObject({ status: 'pending' });
    await expect(handler.process({ id: 'j4', type: SESSION_SUMMARIZE_TYPE, payload, attempts: 3 } as never)).rejects.toThrow('ssh down');
    expect(world.fake.rows[0]).toMatchObject({ status: 'failed', errorCode: 'SUMMARY_FAILED' });
  });

  it('carries neither node member (server-only, permanently)', () => {
    const handler = build() as unknown as Record<string, unknown>;
    expect(handler.nodeResultSchema).toBeUndefined();
    expect(handler.persistNodeResult).toBeUndefined();
    expect(handler.nodeSecretBroker).toBeUndefined();
  });
});
