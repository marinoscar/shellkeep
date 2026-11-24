// Terminal session summaries client (#59). The routes sit under /api/ai/*: `ai:use` and the AI
// kill switch apply. A summary is written by a background job, so the client asks once and then
// polls the summary until it settles; nothing here holds terminal text.

import { api } from './api';

export type SessionSummaryStatus = 'pending' | 'succeeded' | 'failed';

export interface SessionSummaryCommand {
  command: string;
  outcome?: 'ok' | 'error' | 'unknown';
}

export interface SessionSummary {
  id: string;
  sessionId: string;
  jobId: string | null;
  status: SessionSummaryStatus;
  summaryMd: string | null;
  commands: SessionSummaryCommand[] | null;
  findings: Array<{ kind: string; count: number }> | null;
  sourceChars: number | null;
  truncated: boolean;
  model: string | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface SessionSummaryAccepted {
  summaryId: string;
  jobId: string | null;
  status: SessionSummaryStatus;
}

const base = (sessionId: string) => `/ai/terminal/sessions/${encodeURIComponent(sessionId)}/summaries`;

export async function requestSessionSummary(sessionId: string): Promise<SessionSummaryAccepted> {
  return api.post<SessionSummaryAccepted>(base(sessionId), {});
}

export async function listSessionSummaries(sessionId: string): Promise<SessionSummary[]> {
  return api.get<SessionSummary[]>(base(sessionId));
}

export async function getSessionSummary(sessionId: string, summaryId: string): Promise<SessionSummary> {
  return api.get<SessionSummary>(`${base(sessionId)}/${encodeURIComponent(summaryId)}`);
}

/** The summary as a Markdown file: the text, then the commands the model listed. */
export function summaryToMarkdown(summary: SessionSummary, sessionName?: string): string {
  const lines: string[] = [];
  lines.push(`# Session summary${sessionName ? `: ${sessionName}` : ''}`, '');
  lines.push(summary.summaryMd ?? '', '');
  if (summary.commands && summary.commands.length > 0) {
    lines.push('## Commands', '');
    for (const entry of summary.commands) {
      lines.push(`- \`${entry.command.replace(/`/g, "'")}\`${entry.outcome ? ` (${entry.outcome})` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
