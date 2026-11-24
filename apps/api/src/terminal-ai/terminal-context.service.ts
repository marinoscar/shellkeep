// =============================================================================
// TerminalContextService (issue #56): the ONLY door from a terminal to an AI feature
// =============================================================================
//
// Every AI feature that needs terminal text (#57 assist, #58 explain, #59 summary, #64
// runbook AI steps) calls `forAi`. In order it:
//
//   1. loads the session (owner and organization checked: no access is a 404)
//   2. enforces consent (`AI_CONSENT_REQUIRED`) and the per-server switch
//      (`AI_OUTPUT_SHARING_DISABLED` for explain and summary; assist gets metadata only)
//   3. captures the pane (`SessionHistoryService`, the only reader) or takes the client's selection
//   4. strips terminal control sequences
//   5. redacts, with the organization's mode
//   6. caps the size (keeping the most recent text)
//   7. audits one `terminal_ai.request` event: counts and sizes only, NEVER content
//
// The returned text never contains what `redactText` removed. Nothing here logs, traces or
// stores terminal text or a matched secret: a finding is a kind and a count.
// =============================================================================

import { ConflictException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AUDIT_SINK, type AuditSink } from '@marinoscar/platform-api/core';
import { AppMetricsService } from '@marinoscar/platform-api/host';
import { SettingsResolver } from '@marinoscar/platform-api/settings';

import { recordAudit } from '../common/audit/record-audit';
import type { OwnerScope } from '../common/types/owner-scope';
import { redactText, stripAnsi, type RedactionFinding } from '../command-safety';
import { PrismaService } from '../prisma/prisma.service';
import { readStoredFacts } from '../ssh/server-facts.service';
import { SessionHistoryService } from '../terminal/session-history.service';
import { SessionsService } from '../terminal/sessions.service';
import { AI_CONSENT_REQUIRED, AI_OUTPUT_SHARING_DISABLED } from './terminal-ai.error-codes';
import { TERMINAL_AI_REDACTIONS_METRIC } from './terminal-ai.metrics';
import {
  DEFAULT_TERMINAL_AI_SYSTEM_SETTINGS,
  TERMINAL_AI_SETTINGS_KEY,
  type TerminalAiSystemSettings,
  type TerminalAiUserSettings,
} from './terminal-ai.settings';

export type TerminalAiPurpose = 'assist' | 'explain' | 'summary';

/** The AI feature id each purpose spends under (`app-registrations/ai.ts`). */
export const FEATURE_FOR_PURPOSE: Readonly<Record<TerminalAiPurpose, string>> = {
  assist: 'terminal_assist',
  explain: 'terminal_explain',
  summary: 'session_summary',
};

/** Size caps (issue #56). Text beyond a cap is dropped from the OLD end. */
export const TERMINAL_AI_LIMITS = {
  assistLines: 40,
  explainLines: 200,
  explainSelectionBytes: 16 * 1024,
  summaryChars: 200_000,
} as const;

export interface TerminalAiOptions {
  purpose: TerminalAiPurpose;
  /** Lines of scrollback wanted; clamped to the purpose's cap. Summary ignores it (whole history). */
  lines?: number;
  /** Text the user selected in the terminal; used instead of a capture (explain). */
  selection?: string;
}

export interface TerminalAiContext {
  /** Redacted, control-sequence-free terminal text. Empty when the server does not share output. */
  text: string;
  findings: RedactionFinding[];
  truncated: boolean;
  /** The pane's working directory (redacted), or null. */
  cwd: string | null;
  /** `metadata_only`: the server's switch is off; `text` is empty and only os, shell and cwd may be sent. */
  sharing: 'full' | 'metadata_only';
  os: string | null;
  shell: string | null;
}

const lastLines = (text: string, n: number): { text: string; cut: boolean } => {
  const lines = text.split('\n');
  // A trailing newline makes the last element empty; it is not a line of output.
  const end = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  if (end <= n) return { text, cut: false };
  return { text: lines.slice(end - n, end).join('\n'), cut: true };
};

const lastChars = (text: string, n: number): { text: string; cut: boolean } =>
  text.length <= n ? { text, cut: false } : { text: text.slice(text.length - n), cut: true };

const lastBytes = (text: string, n: number): { text: string; cut: boolean } => {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= n) return { text, cut: false };
  // Drop a partial leading code point, if the cut landed inside one.
  let start = buf.length - n;
  while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++;
  return { text: buf.subarray(start).toString('utf8'), cut: true };
};

@Injectable()
export class TerminalContextService {
  private readonly logger = new Logger(TerminalContextService.name);

  constructor(
    private readonly sessions: SessionsService,
    private readonly history: SessionHistoryService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolver,
    @Inject(AUDIT_SINK) private readonly auditSink: AuditSink,
    @Optional() private readonly metrics?: AppMetricsService,
  ) {}

  /** The effective policy for a user: the deployment's value tightened by the organization. */
  async policy(scope: OwnerScope): Promise<TerminalAiSystemSettings & { consentAcceptedAt: string | null }> {
    const system = await this.settings
      .resolveSystem<TerminalAiSystemSettings>(TERMINAL_AI_SETTINGS_KEY, { orgId: scope.orgId })
      .catch((): TerminalAiSystemSettings => DEFAULT_TERMINAL_AI_SYSTEM_SETTINGS);
    const user = await this.settings
      .resolveUser<TerminalAiUserSettings>(TERMINAL_AI_SETTINGS_KEY, scope.userId)
      .catch(() => undefined);
    return { ...system, consentAcceptedAt: user?.consentAcceptedAt ?? null };
  }

  async forAi(sessionId: string, scope: OwnerScope, options: TerminalAiOptions): Promise<TerminalAiContext> {
    const { purpose } = options;
    const session = await this.sessions.findOne(sessionId, scope);

    // 1. Consent. It comes before the switch: an unconsented user learns nothing about the server.
    const policy = await this.policy(scope);
    if (policy.requireConsent && !policy.consentAcceptedAt) {
      throw new ConflictException({
        code: AI_CONSENT_REQUIRED,
        message: 'Accept the terminal AI notice before terminal output can be sent to AI.',
      });
    }

    // 2. The per-server hard switch.
    const profile = await this.prisma.serverProfile.findFirst({
      where: { id: session.serverProfileId, orgId: scope.orgId },
      select: { aiOutputSharing: true, facts: true },
    });
    if (!profile) {
      // Cannot happen for an owned session; fail closed rather than guess.
      throw new ConflictException({
        code: AI_OUTPUT_SHARING_DISABLED,
        message: 'This server does not share terminal output with AI.',
      });
    }
    const sharing = profile.aiOutputSharing !== false;
    if (!sharing && purpose !== 'assist') {
      throw new ConflictException({
        code: AI_OUTPUT_SHARING_DISABLED,
        message: 'This server is set to never send terminal output to AI.',
      });
    }

    const facts = readStoredFacts(profile.facts);
    const cwdRaw = await this.history.currentPath(session, scope);
    const cwd = cwdRaw === null ? null : redactText(stripAnsi(cwdRaw), { mode: policy.redactionMode }).text;
    const base = { cwd, os: facts?.os ?? null, shell: facts?.shell ?? null };

    // Switch off, assist: metadata only. No pane text is captured at all.
    if (!sharing) {
      const context: TerminalAiContext = {
        text: '',
        findings: [],
        truncated: false,
        sharing: 'metadata_only',
        ...base,
      };
      await this.audit(purpose, scope, session.id, session.serverProfileId, context);
      return context;
    }

    // 3. Capture or take the selection.
    const fromSelection = purpose === 'explain' && options.selection !== undefined && options.selection !== '';
    let raw: string;
    if (fromSelection) {
      raw = options.selection as string;
    } else if (purpose === 'summary') {
      raw = await this.history.captureSession(session, scope);
    } else {
      const cap = purpose === 'assist' ? TERMINAL_AI_LIMITS.assistLines : TERMINAL_AI_LIMITS.explainLines;
      raw = await this.history.captureSession(session, scope, {
        lines: Math.min(Math.max(options.lines ?? cap, 1), cap),
      });
    }

    // 4-5. Strip, then redact the WHOLE text, then cap: a cap applied first could cut a private key
    // block in half and leave its body without the header the matcher keys on.
    const redacted = redactText(stripAnsi(raw), { mode: policy.redactionMode });

    // 6. Cap, keeping the most recent text.
    let capped: { text: string; cut: boolean };
    if (purpose === 'summary') capped = lastChars(redacted.text, TERMINAL_AI_LIMITS.summaryChars);
    else if (fromSelection) capped = lastBytes(redacted.text, TERMINAL_AI_LIMITS.explainSelectionBytes);
    else {
      capped = lastLines(
        redacted.text,
        purpose === 'assist' ? TERMINAL_AI_LIMITS.assistLines : TERMINAL_AI_LIMITS.explainLines,
      );
    }

    const context: TerminalAiContext = {
      text: capped.text,
      findings: redacted.findings,
      truncated: capped.cut,
      sharing: 'full',
      ...base,
    };

    for (const finding of context.findings) {
      this.metrics?.add(TERMINAL_AI_REDACTIONS_METRIC, finding.count, { kind: finding.kind });
    }
    // 7. Audit: kinds and counts, never content.
    await this.audit(purpose, scope, session.id, session.serverProfileId, context);
    return context;
  }

  private audit(
    purpose: TerminalAiPurpose,
    scope: OwnerScope,
    sessionId: string,
    serverProfileId: string,
    context: TerminalAiContext,
  ): Promise<void> {
    return recordAudit(this.auditSink, this.logger, {
      action: 'terminal_ai.request',
      actorUserId: scope.userId,
      targetType: 'terminal_session',
      targetId: sessionId,
      meta: {
        feature: FEATURE_FOR_PURPOSE[purpose],
        serverProfileId,
        sessionId,
        // `kind=count` pairs, comma separated; the port carries scalars only.
        findings: context.findings.map((f) => `${f.kind}=${f.count}`).join(','),
        bytesSent: Buffer.byteLength(context.text, 'utf8'),
        truncated: context.truncated,
        sharing: context.sharing,
      },
    });
  }
}
