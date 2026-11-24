// =============================================================================
// Terminal context safety (issue #56)
// =============================================================================
//
// The real `TerminalContextService` and `SessionHistoryService` over a scripted SSH
// transport, and the platform's real `AiService` over `FakeAiProvider`. The proof is
// the fake's own call log: whatever a feature builds from `forAi` and sends to a
// model, a sentinel secret in the pane is in none of it, nor in a log line, an audit
// row, a metric or the context itself.
// =============================================================================

import { ConflictException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import {
  createAiRuntimeHarness,
  HARNESS_MODEL,
  HARNESS_ORG,
  HARNESS_USER,
  type AiRuntimeHarness,
} from '@marinoscar/platform-api/ai/testing';

// Registers the AI features (`terminal_assist`, ...) the real AiService checks.
import '../../src/app-registrations/ai';
import { TerminalAiConsentController } from '../../src/terminal-ai/terminal-ai-consent.controller';
import { SessionHistoryService } from '../../src/terminal/session-history.service';
import { FEATURE_FOR_PURPOSE, TerminalContextService, TERMINAL_AI_LIMITS } from '../../src/terminal-ai/terminal-context.service';
import { AI_CONSENT_REQUIRED, AI_OUTPUT_SHARING_DISABLED } from '../../src/terminal-ai/terminal-ai.error-codes';

// Assembled at run time so no secret-shaped literal sits in the repository (push scanners flag them).
const AWS_KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const PEM_BODY = 'MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun';
const PEM = [
  '-----BEGIN RSA PRIVATE KEY-----',
  ...Array.from({ length: 12 }, (_, i) => `${PEM_BODY}${i}`),
  '-----END RSA PRIVATE KEY-----',
].join('\n');
const GH_TOKEN = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
const SENTINELS = [AWS_KEY, PEM_BODY, 'BEGIN RSA PRIVATE KEY', GH_TOKEN, 'hunter2hunter2'];

const PANE = [
  '\u001b[32muser@host\u001b[0m:~/app$ env',
  `AWS_ACCESS_KEY_ID=${AWS_KEY}`,
  'DB_PASSWORD=hunter2hunter2',
  `GITHUB_TOKEN=${GH_TOKEN}`,
  'user@host:~/app$ cat key.pem',
  PEM,
  'PANE_MARKER_LINE built ok',
].join('\r\n');

const scope = { userId: HARNESS_USER, orgId: HARNESS_ORG };
const session = {
  id: 'sess-1',
  name: 'main',
  status: 'active',
  serverProfileId: 'prof-1',
  tmuxSessionId: 'sk-abc123',
};

interface Setup {
  service: TerminalContextService;
  harness: AiRuntimeHarness;
  audit: jest.Mock;
  metrics: jest.Mock;
  profile: { aiOutputSharing: boolean; facts: unknown };
  policy: { system: Record<string, unknown>; user: Record<string, unknown> | undefined };
  exec: jest.Mock;
}

function setup(): Setup {
  const harness = createAiRuntimeHarness();
  const profile = {
    aiOutputSharing: true,
    facts: { kernel: 'Linux 6.1 x86_64', os: 'linux', shell: '/bin/bash', has: ['tmux'] },
  };
  const policy: Setup['policy'] = {
    system: { redactionMode: 'standard', requireConsent: true },
    user: { consentAcceptedAt: '2026-11-24T10:00:00.000Z' },
  };
  const exec = jest.fn(async (_profile: unknown, command: string) =>
    command.includes('display-message') ? '/home/user/app\n' : PANE,
  );
  const history = new SessionHistoryService(
    { findOne: jest.fn().mockResolvedValue(session) } as never,
    { execForOutput: exec } as never,
    { getDecryptedProfile: jest.fn().mockResolvedValue({ id: 'prof-1' }) } as never,
  );
  const audit = jest.fn().mockResolvedValue(undefined);
  const metrics = jest.fn();
  const service = new TerminalContextService(
    { findOne: jest.fn().mockResolvedValue(session) } as never,
    history,
    { serverProfile: { findFirst: jest.fn(async () => profile) } } as never,
    {
      resolveSystem: jest.fn(async () => policy.system),
      resolveUser: jest.fn(async () => policy.user),
    } as never,
    { record: audit } as never,
    { add: metrics } as never,
  );
  return { service, harness, audit, metrics, profile, policy, exec };
}

/** What a feature does with the context: build a prompt and send it through the real AiService. */
async function sendToAi(s: Setup, feature: string, ctx: Awaited<ReturnType<TerminalContextService['forAi']>>) {
  const input = [
    `os=${ctx.os} shell=${ctx.shell} cwd=${ctx.cwd}`,
    ctx.text === '' ? '(no terminal output shared)' : ctx.text,
  ].join('\n');
  await s.harness.ai.forUser(HARNESS_USER, { orgId: HARNESS_ORG, feature }).respond({ model: HARNESS_MODEL, input });
}

const expectNone = (haystack: unknown) => {
  const text = typeof haystack === 'string' ? haystack : JSON.stringify(haystack);
  for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
};

describe('TerminalContextService', () => {
  let logged: string[];
  const spies: jest.SpyInstance[] = [];

  beforeEach(() => {
    logged = [];
    for (const method of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
      spies.push(
        jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
          logged.push(JSON.stringify(args));
        }),
      );
    }
  });

  afterEach(() => {
    spies.splice(0).forEach((spy) => spy.mockRestore());
  });

  describe('a pane holding secrets', () => {
    it('never reaches the AI provider, the audit row, the metrics, the logs or the response', async () => {
      const s = setup();
      for (const purpose of ['assist', 'explain', 'summary'] as const) {
        const ctx = await s.service.forAi('sess-1', scope, { purpose });
        expectNone(ctx);
        expect(ctx.text).toContain('PANE_MARKER_LINE built ok');
        expect(ctx.text).toContain('[REDACTED:aws_access_key]');
        expect(ctx.text).toContain('[REDACTED:private_key]');
        await sendToAi(s, FEATURE_FOR_PURPOSE[purpose], ctx);
      }

      const calls = s.harness.fake.calls;
      expect(calls.length).toBe(3);
      expect(calls.every((c) => JSON.stringify(c.request).includes('PANE_MARKER_LINE'))).toBe(true);
      expectNone(calls.map((c) => c.request));
      expectNone(s.audit.mock.calls);
      expectNone(s.metrics.mock.calls);
      expectNone(logged);
      expectNone(s.harness.usageEvents);
    });

    it('strips terminal control sequences and carriage returns', async () => {
      const s = setup();
      const ctx = await s.service.forAi('sess-1', scope, { purpose: 'summary' });
      expect(ctx.text).not.toContain('\u001b');
      expect(ctx.text).not.toContain('\r');
    });

    it('redacts a client selection too', async () => {
      const s = setup();
      const ctx = await s.service.forAi('sess-1', scope, {
        purpose: 'explain',
        selection: `error near ${AWS_KEY} in config`,
      });
      expect(ctx.text).toBe('error near [REDACTED:aws_access_key] in config');
      expect(s.exec).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('capture-pane'));
    });

    it('strict mode drops whole lines that had a finding', async () => {
      const s = setup();
      s.policy.system = { redactionMode: 'strict', requireConsent: true };
      const ctx = await s.service.forAi('sess-1', scope, { purpose: 'explain' });
      expect(ctx.text).toContain('[REDACTED LINE]');
      expect(ctx.text).not.toContain('AWS_ACCESS_KEY_ID');
      expect(ctx.text).toContain('PANE_MARKER_LINE built ok');
      expectNone(ctx);
    });

    it('audits kinds, counts and sizes, never content', async () => {
      const s = setup();
      const ctx = await s.service.forAi('sess-1', scope, { purpose: 'explain' });
      expect(s.audit).toHaveBeenCalledTimes(1);
      const event = s.audit.mock.calls[0][0];
      expect(event).toMatchObject({
        action: 'terminal_ai.request',
        actorUserId: HARNESS_USER,
        meta: {
          feature: 'terminal_explain',
          serverProfileId: 'prof-1',
          sessionId: 'sess-1',
          bytesSent: Buffer.byteLength(ctx.text),
          truncated: false,
        },
      });
      expect(event.meta.findings).toContain('aws_access_key=1');
      expect(event.meta.findings).toContain('private_key=1');
      expect(JSON.stringify(event)).not.toContain('PANE_MARKER_LINE');
    });

    it('counts each redaction kind in the app metric', async () => {
      const s = setup();
      await s.service.forAi('sess-1', scope, { purpose: 'explain' });
      expect(s.metrics).toHaveBeenCalledWith('terminalAiRedactions', 1, { kind: 'aws_access_key' });
      expect(s.metrics).toHaveBeenCalledWith('terminalAiRedactions', 1, { kind: 'private_key' });
    });
  });

  describe('the per-server switch', () => {
    it('refuses explain and summary with 409 AI_OUTPUT_SHARING_DISABLED, and sends nothing', async () => {
      const s = setup();
      s.profile.aiOutputSharing = false;
      for (const purpose of ['explain', 'summary'] as const) {
        const error = await s.service.forAi('sess-1', scope, { purpose }).catch((e) => e);
        expect(error).toBeInstanceOf(ConflictException);
        expect(error.getResponse()).toMatchObject({ code: AI_OUTPUT_SHARING_DISABLED });
      }
      expect(s.harness.fake.calls).toHaveLength(0);
      expect(s.exec).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('capture-pane'));
    });

    it('lets assist through with only os, shell and cwd, and no pane text at all', async () => {
      const s = setup();
      s.profile.aiOutputSharing = false;
      const ctx = await s.service.forAi('sess-1', scope, { purpose: 'assist' });
      expect(ctx).toMatchObject({
        text: '',
        sharing: 'metadata_only',
        os: 'linux',
        shell: '/bin/bash',
        cwd: '/home/user/app',
      });
      await sendToAi(s, 'terminal_assist', ctx);
      const sent = JSON.stringify(s.harness.fake.calls.map((c) => c.request));
      expect(sent).toContain('cwd=/home/user/app');
      expect(sent).not.toContain('PANE_MARKER_LINE');
      expectNone(sent);
      // No capture ran for it.
      expect(s.exec).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('capture-pane'));
      expect(s.audit.mock.calls[0][0].meta).toMatchObject({ bytesSent: 0, sharing: 'metadata_only' });
    });
  });

  describe('consent', () => {
    it('is required: 409 AI_CONSENT_REQUIRED, before anything is captured', async () => {
      const s = setup();
      s.policy.user = undefined;
      const error = await s.service.forAi('sess-1', scope, { purpose: 'explain' }).catch((e) => e);
      expect(error.getResponse()).toMatchObject({ code: AI_CONSENT_REQUIRED });
      expect(s.exec).not.toHaveBeenCalled();
      expect(s.audit).not.toHaveBeenCalled();
    });

    it('is not asked for when the organization does not require it', async () => {
      const s = setup();
      s.policy.user = undefined;
      s.policy.system = { redactionMode: 'standard', requireConsent: false };
      await expect(s.service.forAi('sess-1', scope, { purpose: 'explain' })).resolves.toBeDefined();
    });

    it('asks before the switch, so an unconsented user learns nothing about the server', async () => {
      const s = setup();
      s.policy.user = { consentAcceptedAt: null };
      s.profile.aiOutputSharing = false;
      const error = await s.service.forAi('sess-1', scope, { purpose: 'summary' }).catch((e) => e);
      expect(error.getResponse()).toMatchObject({ code: AI_CONSENT_REQUIRED });
    });
  });

  describe('size caps keep the most recent text', () => {
    it('asks tmux for at most the purpose cap in lines', async () => {
      const s = setup();
      await s.service.forAi('sess-1', scope, { purpose: 'assist', lines: 5000 });
      await s.service.forAi('sess-1', scope, { purpose: 'explain', lines: 5000 });
      await s.service.forAi('sess-1', scope, { purpose: 'summary' });
      const commands = s.exec.mock.calls.map((c) => c[1] as string).filter((c) => c.includes('capture-pane'));
      expect(commands[0]).toContain(`-S -${TERMINAL_AI_LIMITS.assistLines} `);
      expect(commands[1]).toContain(`-S -${TERMINAL_AI_LIMITS.explainLines} `);
      expect(commands[2]).toContain('-S - ');
    });

    it('cuts a long capture to the last lines and says so', async () => {
      const s = setup();
      const many = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');
      s.exec.mockImplementation(async (_p: unknown, c: string) => (c.includes('display-message') ? '/x\n' : many));
      const ctx = await s.service.forAi('sess-1', scope, { purpose: 'explain' });
      expect(ctx.text.split('\n')).toHaveLength(TERMINAL_AI_LIMITS.explainLines);
      expect(ctx.text.endsWith('line 299')).toBe(true);
      expect(ctx.truncated).toBe(true);
    });

    it('cuts a selection to 16 KiB and a summary to 200k characters', async () => {
      const s = setup();
      const big = 'abc def '.repeat(10_000);
      const selected = await s.service.forAi('sess-1', scope, { purpose: 'explain', selection: big });
      expect(Buffer.byteLength(selected.text)).toBeLessThanOrEqual(TERMINAL_AI_LIMITS.explainSelectionBytes);
      expect(selected.truncated).toBe(true);

      s.exec.mockImplementation(async (_p: unknown, c: string) => (c.includes('display-message') ? '/x\n' : 'word '.repeat(80_000)));
      const summary = await s.service.forAi('sess-1', scope, { purpose: 'summary' });
      expect(summary.text.length).toBeLessThanOrEqual(TERMINAL_AI_LIMITS.summaryChars);
      expect(summary.truncated).toBe(true);
    });
  });

  describe('POST /api/ai/terminal/consent', () => {
    it('clears AI_CONSENT_REQUIRED and is audited', async () => {
      const s = setup();
      s.policy.user = undefined;
      const patchSettings = jest.fn(async (_userId: string, body: { terminalAi: { consentAcceptedAt: string } }) => {
        s.policy.user = { consentAcceptedAt: body.terminalAi.consentAcceptedAt };
      });
      const controller = new TerminalAiConsentController(s.service, { patchSettings } as never, { record: s.audit } as never);

      await expect(controller.status(HARNESS_USER, HARNESS_ORG)).resolves.toEqual({
        required: true,
        consentAcceptedAt: null,
        redactionMode: 'standard',
      });
      await expect(s.service.forAi('sess-1', scope, { purpose: 'explain' })).rejects.toMatchObject({
        response: { code: AI_CONSENT_REQUIRED },
      });

      const { consentAcceptedAt } = await controller.accept(HARNESS_USER, HARNESS_ORG, {});
      expect(new Date(consentAcceptedAt).toISOString()).toBe(consentAcceptedAt);
      expect(patchSettings).toHaveBeenCalledWith(HARNESS_USER, { terminalAi: { consentAcceptedAt } });
      expect(s.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'terminal_ai.consent', actorUserId: HARNESS_USER }));

      await expect(s.service.forAi('sess-1', scope, { purpose: 'explain' })).resolves.toMatchObject({ sharing: 'full' });
      await expect(controller.status(HARNESS_USER, HARNESS_ORG)).resolves.toMatchObject({ consentAcceptedAt });
    });
  });
});
