// =============================================================================
// `terminal.session_reaped` email (issue #51)
// =============================================================================
//
// "Your terminal session was closed after inactivity." One message per owner per
// reaper pass, listing the sessions that pass terminated.
//
// WHAT IT NEVER CARRIES: terminal output, a command, a credential, a
// `username@host` pair or a hostname. The server is named by its PROFILE name
// only. Every interpolation goes through the `html` tag, so a session or profile
// name containing markup cannot become markup.
// =============================================================================

import {
  SafeHtml,
  TRANSACTIONAL_EMAIL_HEADERS,
  html,
  plainText,
  renderLayout,
  resolveEmailRenderContext,
  type EmailRenderContext,
  type RenderedEmail,
} from '@marinoscar/platform-api/email';

import { MAX_LISTED_SESSIONS, formatIdleDuration } from './idle-duration';

/** One terminated session, as the notification lists it. */
export interface ReapedSessionLine {
  /** The session's name. */
  name: string;
  /** The server profile's name (never its host or user). */
  serverName: string;
  /** Whole minutes the session had been idle when it was closed. */
  idleMinutes: number;
}

/** Everything the message renders, and the payload the bell and push read. Plain JSON. */
export interface TerminalSessionReapedData {
  /** At most {@link MAX_LISTED_SESSIONS} sessions, longest idle first. */
  sessions: ReapedSessionLine[];
  /** How many more were closed than are listed (0 when all are). */
  moreCount: number;
}

declare module '@marinoscar/platform-api/email' {
  interface EmailTemplateDataMap {
    'terminal-session-reaped': TerminalSessionReapedData;
  }
}

/** Where the CTA points, appended to the deployment's base URL. */
export const SESSIONS_PATH = '/sessions';

function lineText(line: ReapedSessionLine): string {
  return `${line.name} on ${line.serverName}, idle for ${formatIdleDuration(line.idleMinutes)}`;
}

/** Renders the "your terminal session was closed after inactivity" message. */
export function terminalSessionReapedEmail(
  data: TerminalSessionReapedData,
  ctx?: EmailRenderContext,
): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const total = data.sessions.length + data.moreCount;
  const subject =
    total === 1
      ? 'Your terminal session was closed after inactivity'
      : `${total} of your terminal sessions were closed after inactivity`;
  const ctaUrl = context.appUrl ? `${context.appUrl.replace(/\/+$/, '')}${SESSIONS_PATH}` : undefined;
  const more = data.moreCount > 0 ? `and ${data.moreCount} more` : '';

  const items: SafeHtml[] = data.sessions.map(
    (line) => html`<li style="margin:0 0 6px 0;"><strong>${line.name}</strong> on ${line.serverName}, idle for ${formatIdleDuration(line.idleMinutes)}</li>`,
  );

  const moreHtml = more ? html`<p style="margin:0 0 16px 0;">${more}</p>` : SafeHtml.EMPTY;

  const bodyHtml = html`
    <p style="margin:0 0 16px 0;">
      ${total === 1 ? 'A terminal session of yours was' : 'Terminal sessions of yours were'} closed because
      ${total === 1 ? 'it' : 'they'} stayed disconnected past the idle limit set by an administrator.
    </p>
    <ul style="margin:0 0 16px 20px;padding:0;font-size:14px;line-height:20px;color:#1f2937;">
      ${items}
    </ul>
    ${moreHtml}
    <p style="margin:0;font-size:13px;line-height:20px;color:#4b5563;">
      Programs still running inside the session are not part of this message. Open Sessions to start a new one.
      You can change how you are told about this under your notification settings.
    </p>
  `;

  const textLines: [string, ...string[]] = [
    `${total === 1 ? 'A terminal session of yours was' : 'Terminal sessions of yours were'} closed because ${total === 1 ? 'it' : 'they'} stayed disconnected past the idle limit set by an administrator.`,
    '',
    ...data.sessions.map((line) => `  - ${lineText(line)}`),
    ...(more ? [`  - ${more}`] : []),
    '',
    'Open Sessions to start a new one. You can change how you are told about this under your notification settings.',
  ];

  const htmlDocument = renderLayout(
    {
      title: 'Session closed after inactivity',
      previewText: data.sessions[0] ? lineText(data.sessions[0]) : subject,
      bodyHtml,
      ctaLabel: ctaUrl ? 'Open sessions' : undefined,
      ctaUrl,
    },
    ctx,
  );

  const text = plainText(
    {
      title: 'Session closed after inactivity',
      lines: textLines,
      ctaLabel: ctaUrl ? 'Open sessions' : undefined,
      ctaUrl,
    },
    ctx,
  );

  return { subject, html: htmlDocument, text, headers: { ...TRANSACTIONAL_EMAIL_HEADERS } };
}
