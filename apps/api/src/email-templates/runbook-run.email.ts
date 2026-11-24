// =============================================================================
// Runbook run emails (issue #51)
// =============================================================================
//
// Three messages, defined here so their keys and copy are reviewed once and
// Fleet Runbooks (#61) only calls `notify`:
//
//   runbook-run-finished       a run completed on every target
//   runbook-run-failed         a run ended with failures
//   runbook-approval-requested a step is waiting for this person to approve it
//
// WHAT THEY NEVER CARRY: command output, a script body, a credential, a
// `username@host` pair or a hostname. A run is named by its runbook, its version
// and its target COUNTS; a link points into the app. Every interpolation goes
// through the `html` tag. Links are root-relative paths joined to the
// deployment's base URL, so a payload can never aim a button at another site.
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

/** What every run notification carries. Plain JSON. */
export interface RunbookRunNotificationData {
  /** The runbook's name. */
  runbookName: string;
  /** The runbook version the run executed. */
  version: number;
  /** Targets the run covered. */
  targetsTotal: number;
  /** Targets that finished their steps. */
  targetsSucceeded: number;
  /** Targets that failed. */
  targetsFailed: number;
  /** Root-relative path to the run page (`/runbooks/runs/<id>`). */
  runLink: string;
}

/** What `runbooks.approval_requested` carries: the run plus the step and the approver's link. */
export interface RunbookApprovalRequestedData {
  runbookName: string;
  version: number;
  /** The step waiting for approval. */
  stepName: string;
  /** Targets the run covers. */
  targetsTotal: number;
  /** Root-relative path to the run page. */
  runLink: string;
  /** Root-relative path where the approver approves or rejects the step. */
  approvalLink: string;
}

declare module '@marinoscar/platform-api/email' {
  interface EmailTemplateDataMap {
    'runbook-run-finished': RunbookRunNotificationData;
    'runbook-run-failed': RunbookRunNotificationData;
    'runbook-approval-requested': RunbookApprovalRequestedData;
  }
}

/** Joins a root-relative link to the base URL; `undefined` for an absolute or empty link. */
function linkUrl(appUrl: string | null, path: string): string | undefined {
  if (!appUrl || !path.startsWith('/') || path.startsWith('//')) return undefined;
  return `${appUrl.replace(/\/+$/, '')}${path}`;
}

function countsLine(data: { targetsTotal: number; targetsSucceeded: number; targetsFailed: number }): string {
  return `${data.targetsSucceeded} of ${data.targetsTotal} targets succeeded, ${data.targetsFailed} failed`;
}

function detailRow(label: string, value: string): SafeHtml {
  return html`<tr>
    <td style="padding:6px 16px 6px 0;font-size:14px;line-height:20px;color:#4b5563;white-space:nowrap;vertical-align:top;">${label}</td>
    <td style="padding:6px 0;font-size:14px;line-height:20px;color:#1f2937;vertical-align:top;"><strong>${value}</strong></td>
  </tr>`;
}

interface Built {
  subject: string;
  title: string;
  intro: string;
  rows: Array<[string, string]>;
  closing: string;
  ctaLabel: string;
  ctaPath: string;
}

function render(built: Built, ctx?: EmailRenderContext): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  const ctaUrl = linkUrl(context.appUrl, built.ctaPath);
  const bodyHtml = html`
    <p style="margin:0 0 16px 0;">${built.intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
      ${built.rows.map(([label, value]) => detailRow(label, value))}
    </table>
    <p style="margin:0;font-size:13px;line-height:20px;color:#4b5563;">${built.closing}</p>
  `;
  const lines: [string, ...string[]] = [
    built.intro,
    '',
    ...built.rows.map(([label, value]) => `  ${label}: ${value}`),
    '',
    built.closing,
  ];
  return {
    subject: built.subject,
    html: renderLayout(
      {
        title: built.title,
        previewText: built.subject,
        bodyHtml,
        ctaLabel: ctaUrl ? built.ctaLabel : undefined,
        ctaUrl,
      },
      ctx,
    ),
    text: plainText({ title: built.title, lines, ctaLabel: ctaUrl ? built.ctaLabel : undefined, ctaUrl }, ctx),
    headers: { ...TRANSACTIONAL_EMAIL_HEADERS },
  };
}

/** `runbooks.run_finished`. */
export function runbookRunFinishedEmail(data: RunbookRunNotificationData, ctx?: EmailRenderContext): RenderedEmail {
  return render(
    {
      subject: `Runbook "${data.runbookName}" finished`,
      title: 'Runbook run finished',
      intro: 'A runbook run you started has finished.',
      rows: [
        ['Runbook', data.runbookName],
        ['Version', String(data.version)],
        ['Result', countsLine(data)],
      ],
      closing: 'Open the run to see the result of each step. This message holds no command output.',
      ctaLabel: 'Open run',
      ctaPath: data.runLink,
    },
    ctx,
  );
}

/** `runbooks.run_failed`. */
export function runbookRunFailedEmail(data: RunbookRunNotificationData, ctx?: EmailRenderContext): RenderedEmail {
  return render(
    {
      subject: `Runbook "${data.runbookName}" failed on ${data.targetsFailed} of ${data.targetsTotal} targets`,
      title: 'Runbook run failed',
      intro: 'A runbook run you started ended with failures.',
      rows: [
        ['Runbook', data.runbookName],
        ['Version', String(data.version)],
        ['Result', countsLine(data)],
      ],
      closing: 'Open the run to see which steps failed and retry them. This message holds no command output.',
      ctaLabel: 'Open run',
      ctaPath: data.runLink,
    },
    ctx,
  );
}

/** `runbooks.approval_requested`. */
export function runbookApprovalRequestedEmail(
  data: RunbookApprovalRequestedData,
  ctx?: EmailRenderContext,
): RenderedEmail {
  return render(
    {
      subject: `Approval needed: "${data.stepName}" in runbook "${data.runbookName}"`,
      title: 'Approval needed',
      intro: 'A runbook run is paused until someone approves the next step.',
      rows: [
        ['Runbook', data.runbookName],
        ['Version', String(data.version)],
        ['Step', data.stepName],
        ['Targets', String(data.targetsTotal)],
      ],
      closing: 'Nothing runs on the targets until you approve. You can also reject the step from the same page.',
      ctaLabel: 'Review and approve',
      ctaPath: data.approvalLink,
    },
    ctx,
  );
}
