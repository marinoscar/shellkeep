// =============================================================================
// Explain a selection or the last error (issue #58)
// =============================================================================
//
// The real controller, `TerminalAssistService`, `TerminalContextService` and
// `SessionHistoryService` over a scripted SSH exec, and the platform's real `AiService` over
// `FakeAiProvider`. The proof is the fake's own call log (what a model would receive) and the
// SSE frames (what the browser receives).
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
import { SettingsResolver } from '@marinoscar/platform-api/settings';

import '../../src/app-registrations/ai';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SessionHistoryService } from '../../src/terminal/session-history.service';
import { SessionsService } from '../../src/terminal/sessions.service';
import { TerminalExplainController } from '../../src/terminal-ai/terminal-explain.controller';
import { TerminalExplainService } from '../../src/terminal-ai/terminal-explain.service';
import { TerminalContextService } from '../../src/terminal-ai/terminal-context.service';
import { withoutAuthGuards } from '../helpers/allow-guards';

// Assembled at run time so no secret-shaped literal sits in the repository.
const PASSWORD = ['hun', 'ter2'].join('');
const AWS_KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const SESSION_ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const OTHER_SESSION_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const PANE = ['user@host:~$ env', `AWS_ACCESS_KEY_ID=${AWS_KEY}`, 'PANE_MARKER_LINE ok', `error: password=${PASSWORD}`].join('\n');
const session = { id: SESSION_ID, name: 'main', status: 'active', serverProfileId: 'prof-1', tmuxSessionId: 'sk-abc123' };

interface Frame {
  event: string;
  data: Record<string, unknown>;
}

const parseFrames = (body: string): Frame[] =>
  body
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('event:'))
    .map((chunk) => {
      const [eventLine, dataLine] = chunk.split('\n');
      return {
        event: (eventLine as string).slice('event: '.length),
        data: JSON.parse((dataLine as string).slice('data: '.length)) as Record<string, unknown>,
      };
    });

describe('POST /api/ai/terminal/explain', () => {
  let app: NestFastifyApplication;
  let harness: AiRuntimeHarness;
  let profile: { aiOutputSharing: boolean; facts: unknown };
  let exec: jest.Mock;
  let audit: jest.Mock;
  let consent: string | null = '2026-11-24T10:00:00.000Z';
  let permissions: string[] = ['ai:use', 'sessions:read'];
  let scripted: { outputText: string } = { outputText: '' };
  let logged: string[];
  const spies: jest.SpyInstance[] = [];

  beforeEach(async () => {
    logged = [];
    for (const method of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
      spies.push(jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => void logged.push(JSON.stringify(args))));
    }
    permissions = ['ai:use', 'sessions:read'];
    consent = '2026-11-24T10:00:00.000Z';
    scripted = { outputText: '' };
    harness = createAiRuntimeHarness({ fake: { responses: () => scripted } });
    profile = {
      aiOutputSharing: true,
      facts: { kernel: 'Linux 6.1', os: 'linux', shell: '/bin/bash', prettyName: 'Distro X 1', packageManager: 'apt', has: ['tmux'] },
    };
    exec = jest.fn(async (_p: unknown, command: string) => (command.includes('display-message') ? '/srv/app\n' : PANE));
    audit = jest.fn().mockResolvedValue(undefined);
    const findOne = jest.fn(async (id: string) => {
      if (id !== SESSION_ID) throw new NotFoundException('not found');
      return session;
    });
    const history = new SessionHistoryService(
      { findOne } as never,
      { execForOutput: exec } as never,
      { getDecryptedProfileForSession: jest.fn().mockResolvedValue({ id: 'prof-1' }) } as never,
    );

    const moduleRef = await withoutAuthGuards(
      Test.createTestingModule({
        controllers: [TerminalExplainController],
        providers: [
          TerminalExplainService,
          TerminalContextService,
          {
            provide: AiService,
            useValue: {
              forUser: (userId: string, scope: Parameters<typeof harness.ai.forUser>[1]) => {
                const client = harness.ai.forUser(userId, scope);
                return {
                  openStream: (req: Parameters<typeof client.openStream>[0], opts?: Parameters<typeof client.openStream>[1]) =>
                    client.openStream({ ...req, model: HARNESS_MODEL }, opts),
                };
              },
            },
          },
          { provide: SessionsService, useValue: { findOne } },
          { provide: SessionHistoryService, useValue: history },
          { provide: PrismaService, useValue: { serverProfile: { findFirst: jest.fn(async () => profile) } } },
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

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api');
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

  const post = (body: Record<string, unknown>, path = '') =>
    app.inject({ method: 'POST', url: `/api/ai/terminal/explain${path}`, payload: body });
  const selection = (text: string) => ({ mode: 'selection', sessionId: SESSION_ID, selection: text });
  const providerInput = () => JSON.stringify(harness.fake.calls.map((c) => c.request));

  const ANSWER = [
    '## What happened',
    'The login failed.',
    '## Likely cause',
    'A wrong credential.',
    '## Suggested fix',
    'Check the service status.',
    'COMMAND: systemctl status app.service',
  ].join('\n');

  it('redacts a selection before the model sees it and returns the parsed suggested command', async () => {
    scripted = { outputText: ANSWER };
    const res = await post(selection(`login: password=${PASSWORD}\nkey ${AWS_KEY}`));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const frames = parseFrames(res.body);
    expect(frames[0]).toMatchObject({ event: 'context', data: { truncated: false } });
    expect(frames[0]?.data.lines).toBe(2);
    expect(frames.some((f) => f.event === 'delta')).toBe(true);
    const result = frames[frames.length - 1] as Frame;
    expect(result.event).toBe('result');
    expect(result.data.markdown).toContain('## Suggested fix');
    expect(result.data.markdown).not.toContain('COMMAND:');
    expect(result.data.suggestedCommand).toMatchObject({
      command: 'systemctl status app.service',
      risk: 'low',
      destructive: false,
    });

    const input = providerInput();
    expect(input).toContain('password=[REDACTED:kv_secret]');
    expect(input).not.toContain(PASSWORD);
    expect(input).not.toContain(AWS_KEY);
    expect(res.body).not.toContain(PASSWORD);
    expect(JSON.stringify(audit.mock.calls)).not.toContain(PASSWORD);
    expect(audit.mock.calls[0][0]).toMatchObject({ action: 'terminal_ai.request', meta: { feature: 'terminal_explain' } });
    // The selection is used as given: nothing is captured from the pane.
    expect(exec).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('capture-pane'));
  });

  it('last_error captures the last 200 lines and sends them redacted', async () => {
    scripted = { outputText: ANSWER };
    const res = await post({ mode: 'last_error', sessionId: SESSION_ID });
    expect(res.statusCode).toBe(200);
    const captures = exec.mock.calls.filter(([, command]) => String(command).includes('capture-pane'));
    expect(captures).toHaveLength(1);
    expect(String(captures[0][1])).toContain('-S -200');
    const input = providerInput();
    expect(input).toContain('PANE_MARKER_LINE');
    expect(input).toContain('most recent failing command');
    expect(input).not.toContain(PASSWORD);
    expect(input).not.toContain(AWS_KEY);
  });

  it('an answer without a COMMAND line has no suggestedCommand', async () => {
    scripted = { outputText: '## What happened\nNothing wrong.\n## Likely cause\nn/a\n## Suggested fix\nNone.' };
    const frames = parseFrames((await post(selection('all good'))).body);
    const result = frames[frames.length - 1] as Frame;
    expect(result.event).toBe('result');
    expect(result.data.suggestedCommand).toBeUndefined();
  });

  it('classifies the suggested fix on the server, whatever the model claims', async () => {
    scripted = { outputText: '## What happened\nx\n## Likely cause\nx\n## Suggested fix\nThis is safe.\nCOMMAND: rm -rf / --no-preserve-root' };
    const frames = parseFrames((await post(selection('boom'))).body);
    const result = frames[frames.length - 1] as Frame;
    expect(result.data.suggestedCommand).toMatchObject({ risk: 'high', destructive: true });
  });

  it('drops a suggested command with a control character and keeps the explanation', async () => {
    scripted = { outputText: '## What happened\nx\n## Suggested fix\ny\nCOMMAND: ls\u001b[2J' };
    const frames = parseFrames((await post(selection('boom'))).body);
    const result = frames[frames.length - 1] as Frame;
    expect(result.event).toBe('result');
    expect(result.data.suggestedCommand).toBeUndefined();
    expect(String(result.data.markdown)).not.toContain('COMMAND');
  });

  it('answers an empty model answer with an in-band AI_EXPLAIN_EMPTY error', async () => {
    scripted = { outputText: '   ' };
    const frames = parseFrames((await post(selection('boom'))).body);
    expect(frames[frames.length - 1]).toMatchObject({ event: 'error', data: { code: 'AI_EXPLAIN_EMPTY' } });
  });

  it('preview makes no model call and returns the same redacted text the explain call sends', async () => {
    scripted = { outputText: ANSWER };
    const body = selection(`login: password=${PASSWORD}\nkey ${AWS_KEY}\nline three`);
    const preview = await post(body, '/preview');
    expect(preview.statusCode).toBe(200);
    expect(harness.fake.calls).toHaveLength(0);
    const data = (JSON.parse(preview.body) as { data?: Record<string, unknown> }).data ?? (JSON.parse(preview.body) as Record<string, unknown>);
    expect(String(data.text)).toContain('password=[REDACTED:kv_secret]');
    expect(String(data.text)).not.toContain(PASSWORD);
    expect((data.findings as Array<{ kind: string }>).length).toBeGreaterThan(0);

    await post(body);
    expect(harness.fake.calls).toHaveLength(1);
    expect(providerInput()).toContain(JSON.stringify(String(data.text)).slice(1, -1));
  });

  it('preview of last_error also makes no model call', async () => {
    const preview = await post({ mode: 'last_error', sessionId: SESSION_ID }, '/preview');
    expect(preview.statusCode).toBe(200);
    expect(harness.fake.calls).toHaveLength(0);
    expect(preview.body).toContain('PANE_MARKER_LINE');
    expect(preview.body).not.toContain(PASSWORD);
  });

  it.each(['', '/preview'])('answers 409 AI_OUTPUT_SHARING_DISABLED when the server shares no output (%j)', async (path) => {
    profile.aiOutputSharing = false;
    const res = await post(selection('boom'), path);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('AI_OUTPUT_SHARING_DISABLED');
    expect(harness.fake.calls).toHaveLength(0);
    expect(exec).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('capture-pane'));
  });

  it.each(['', '/preview'])('answers 409 AI_CONSENT_REQUIRED without consent (%j)', async (path) => {
    consent = null;
    const res = await post(selection('boom'), path);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('AI_CONSENT_REQUIRED');
    expect(harness.fake.calls).toHaveLength(0);
  });

  it.each(['', '/preview'])("answers 404 for another user's session, before any model call (%j)", async (path) => {
    const res = await post({ mode: 'last_error', sessionId: OTHER_SESSION_ID }, path);
    expect(res.statusCode).toBe(404);
    expect(harness.fake.calls).toHaveLength(0);
  });

  it('rejects a bad body with 400', async () => {
    expect((await post({ mode: 'selection', sessionId: SESSION_ID, selection: '' })).statusCode).toBe(400);
    expect((await post(selection('x'.repeat(16385)))).statusCode).toBe(400);
    expect((await post({ mode: 'selection', sessionId: SESSION_ID })).statusCode).toBe(400);
    expect((await post({ mode: 'other', sessionId: SESSION_ID })).statusCode).toBe(400);
    expect((await post({ mode: 'last_error', sessionId: 'nope' })).statusCode).toBe(400);
    expect((await post({ mode: 'last_error', sessionId: 'nope' }, '/preview')).statusCode).toBe(400);
  });

  it.each(['', '/preview'])('answers 403 without sessions:read, before any context or model call (%j)', async (path) => {
    permissions = ['ai:use'];
    const res = await post(selection('boom'), path);
    expect(res.statusCode).toBe(403);
    expect(harness.fake.calls).toHaveLength(0);
    expect(exec).not.toHaveBeenCalled();
  });

  it('never logs the selection, the screen or the answer', async () => {
    scripted = { outputText: ANSWER };
    await post(selection('UNIQUE_SELECTION_TEXT'));
    await post({ mode: 'last_error', sessionId: SESSION_ID });
    await post(selection('UNIQUE_SELECTION_TEXT'), '/preview');
    const text = logged.join('\n');
    expect(text).not.toContain('UNIQUE_SELECTION_TEXT');
    expect(text).not.toContain('PANE_MARKER_LINE');
    expect(text).not.toContain('systemctl status');
    expect(text).not.toContain('login failed');
  });
});
