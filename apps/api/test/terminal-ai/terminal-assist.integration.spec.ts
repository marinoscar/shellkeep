// =============================================================================
// Terminal command assist (issue #57)
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
import { TerminalAssistController } from '../../src/terminal-ai/terminal-assist.controller';
import { TerminalAssistService } from '../../src/terminal-ai/terminal-assist.service';
import { TerminalContextService } from '../../src/terminal-ai/terminal-context.service';
import { withoutAuthGuards } from '../helpers/allow-guards';

// Assembled at run time so no secret-shaped literal sits in the repository.
const AWS_KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const SESSION_ID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const OTHER_SESSION_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const PANE = ['user@host:~$ env', `AWS_ACCESS_KEY_ID=${AWS_KEY}`, 'PANE_MARKER_LINE ok'].join('\n');
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

describe('POST /api/ai/terminal/assist', () => {
  let app: NestFastifyApplication;
  let harness: AiRuntimeHarness;
  let profile: { aiOutputSharing: boolean; facts: unknown };
  let exec: jest.Mock;
  let audit: jest.Mock;
  let scripted: { outputText: string } = { outputText: '' };
  let logged: string[];
  const spies: jest.SpyInstance[] = [];

  beforeEach(async () => {
    logged = [];
    for (const method of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
      spies.push(jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => void logged.push(JSON.stringify(args))));
    }
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
      { getDecryptedProfile: jest.fn().mockResolvedValue({ id: 'prof-1' }) } as never,
    );

    const moduleRef = await withoutAuthGuards(
      Test.createTestingModule({
        controllers: [TerminalAssistController],
        providers: [
          TerminalAssistService,
          TerminalContextService,
          {
            // The harness has no `ai.defaultModel` user setting, which the feature relies on, so the
            // test names the harness model on the way through; everything else is the real facade.
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
              resolveUser: async () => ({ consentAcceptedAt: '2026-11-24T10:00:00.000Z' }),
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
    app.useGlobalPipes(new ZodValidationPipe());
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRequest', (async (req: { requestUser?: unknown; user?: unknown }) => {
        req.user = { id: HARNESS_USER, activeOrgId: HARNESS_ORG };
        req.requestUser = { id: HARNESS_USER, activeOrgId: HARNESS_ORG, roles: [], permissions: [] };
      }) as never);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    spies.splice(0).forEach((spy) => spy.mockRestore());
    await app.close();
  });

  const post = (body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/ai/terminal/assist', payload: body });

  const providerInput = () => JSON.stringify(harness.fake.calls.map((c) => c.request));

  it('streams context, deltas and a low-risk result, sending OS, shell and cwd but no secret', async () => {
    scripted = { outputText: 'COMMAND: du -ah /var | sort -rh | head -n 10\nWHY: Lists the ten largest entries.' };
    const res = await post({ sessionId: SESSION_ID, prompt: 'find the 10 largest files under /var' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const frames = parseFrames(res.body);
    expect(frames[0]).toMatchObject({ event: 'context', data: { os: 'linux', shell: '/bin/bash', cwd: '/srv/app' } });
    expect(frames.some((f) => f.event === 'delta')).toBe(true);
    const result = frames[frames.length - 1] as Frame;
    expect(result).toMatchObject({
      event: 'result',
      data: { command: 'du -ah /var | sort -rh | head -n 10', risk: 'low', destructive: false },
    });

    const input = providerInput();
    expect(input).toContain('linux');
    expect(input).toContain('/bin/bash');
    expect(input).toContain('/srv/app');
    expect(input).toContain('PANE_MARKER_LINE');
    expect(input).not.toContain(AWS_KEY);
    expect(res.body).not.toContain(AWS_KEY);
    expect(JSON.stringify(audit.mock.calls)).not.toContain(AWS_KEY);
    expect(audit.mock.calls[0][0]).toMatchObject({ action: 'terminal_ai.request', meta: { feature: 'terminal_assist' } });
  });

  it('classifies the command on the server: a destructive suggestion is flagged', async () => {
    scripted = { outputText: 'COMMAND: rm -rf / --no-preserve-root\nWHY: Removes everything.' };
    const frames = parseFrames((await post({ sessionId: SESSION_ID, prompt: 'clean up' })).body);
    const result = frames.find((f) => f.event === 'result') as Frame;
    expect(result.data).toMatchObject({ risk: 'high', destructive: true });
    expect((result.data.reasons as string[]).length).toBeGreaterThan(0);
  });

  it('never carries a newline or control character into a result command', async () => {
    scripted = { outputText: 'COMMAND: ls\u001b[2J\nWHY: x' };
    const frames = parseFrames((await post({ sessionId: SESSION_ID, prompt: 'list' })).body);
    expect(frames.find((f) => f.event === 'result')).toBeUndefined();
    expect(frames[frames.length - 1]).toMatchObject({ event: 'error', data: { code: 'AI_ASSIST_UNPARSEABLE' } });
  });

  it('answers unparseable model output with an in-band AI_ASSIST_UNPARSEABLE error', async () => {
    scripted = { outputText: 'Sure! You could try looking around.' };
    const frames = parseFrames((await post({ sessionId: SESSION_ID, prompt: 'help' })).body);
    expect(frames[frames.length - 1]).toMatchObject({ event: 'error', data: { code: 'AI_ASSIST_UNPARSEABLE' } });
  });

  it('sends no pane lines when includeScreen is false (and captures none)', async () => {
    scripted = { outputText: 'COMMAND: pwd\nWHY: Prints the directory.' };
    const res = await post({ sessionId: SESSION_ID, prompt: 'where am I', includeScreen: false });
    const frames = parseFrames(res.body);
    expect(frames[0]).toMatchObject({ event: 'context', data: { screenLines: 0 } });
    expect(providerInput()).not.toContain('PANE_MARKER_LINE');
    expect(exec).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('capture-pane'));
  });

  it('sends no pane lines when the server profile does not share output', async () => {
    profile.aiOutputSharing = false;
    scripted = { outputText: 'COMMAND: pwd\nWHY: Prints the directory.' };
    const frames = parseFrames((await post({ sessionId: SESSION_ID, prompt: 'where am I' })).body);
    expect(frames[0]).toMatchObject({ event: 'context', data: { screenLines: 0 } });
    expect(frames[frames.length - 1]).toMatchObject({ event: 'result' });
    expect(providerInput()).not.toContain('PANE_MARKER_LINE');
  });

  it("answers 404 for another user's session, before any model call", async () => {
    const res = await post({ sessionId: OTHER_SESSION_ID, prompt: 'hello' });
    expect(res.statusCode).toBe(404);
    expect(harness.fake.calls).toHaveLength(0);
  });

  it('rejects an empty or oversized prompt and a bad session id with 400', async () => {
    expect((await post({ sessionId: SESSION_ID, prompt: '' })).statusCode).toBe(400);
    expect((await post({ sessionId: SESSION_ID, prompt: 'x'.repeat(2001) })).statusCode).toBe(400);
    expect((await post({ sessionId: 'nope', prompt: 'hi' })).statusCode).toBe(400);
  });

  it('never logs the command, the prompt or the screen', async () => {
    scripted = { outputText: 'COMMAND: du -ah /var\nWHY: Sizes.' };
    await post({ sessionId: SESSION_ID, prompt: 'UNIQUE_PROMPT_TEXT' });
    const text = logged.join('\n');
    expect(text).not.toContain('du -ah');
    expect(text).not.toContain('UNIQUE_PROMPT_TEXT');
    expect(text).not.toContain('PANE_MARKER_LINE');
  });
});
