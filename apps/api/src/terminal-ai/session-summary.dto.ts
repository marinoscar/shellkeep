import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const sessionSummaryParamsSchema = z.object({ id: z.string().uuid() });
export class SessionSummaryParamsDto extends createZodDto(sessionSummaryParamsSchema) {}

export const sessionSummaryItemParamsSchema = z.object({ id: z.string().uuid(), summaryId: z.string().uuid() });
export class SessionSummaryItemParamsDto extends createZodDto(sessionSummaryItemParamsSchema) {}

export type SessionSummaryStatus = 'pending' | 'succeeded' | 'failed';

/** What the API returns for one summary. Terminal text is never part of it. */
export interface SessionSummaryView {
  id: string;
  sessionId: string;
  jobId: string | null;
  status: SessionSummaryStatus;
  summaryMd: string | null;
  commands: Array<{ command: string; outcome?: 'ok' | 'error' | 'unknown' }> | null;
  findings: Array<{ kind: string; count: number }> | null;
  sourceChars: number | null;
  truncated: boolean;
  model: string | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** The 202 body of `POST /api/ai/terminal/sessions/:id/summaries`. */
export interface SessionSummaryAccepted {
  summaryId: string;
  jobId: string | null;
  status: SessionSummaryStatus;
}
