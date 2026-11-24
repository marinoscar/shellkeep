// =============================================================================
// Session summaries: the request side (issue #59)
// =============================================================================
//
// Creates a `pending` summary row and queues `ai.session.summarize`. Everything that can be
// answered without reading the pane is answered here, before anything is queued: 404 for a session
// that is not the caller's, 400 for a terminated one, 409 `AI_CONSENT_REQUIRED` and
// `AI_OUTPUT_SHARING_DISABLED`. No terminal text is read here (the job reads it, through
// `TerminalContextService.forAi`, which checks all of it again).
// =============================================================================

import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JobsService } from '@marinoscar/platform-api/jobs';
import type { TerminalSessionSummary } from '@prisma/client';

import type { OwnerScope } from '../common/types/owner-scope';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_TERMINATED } from './terminal-ai.error-codes';
import { SESSION_SUMMARIZE_SUBJECT, SESSION_SUMMARIZE_TYPE } from './jobs/session-summarize.handler';
import type { SessionSummaryAccepted, SessionSummaryStatus, SessionSummaryView } from './session-summary.dto';
import { TerminalContextService } from './terminal-context.service';

/** The newest summaries a session lists. */
export const SESSION_SUMMARY_LIST_LIMIT = 20;
/** A summary still `pending` this long after it was asked for is abandoned (a job that ended without settling its row). */
export const SESSION_SUMMARY_STALE_MS = 60 * 60_000;
export const SUMMARY_TIMED_OUT = 'SUMMARY_TIMED_OUT';

export const toSummaryView = (row: TerminalSessionSummary): SessionSummaryView => ({
  id: row.id,
  sessionId: row.sessionId,
  jobId: row.jobId,
  status: row.status as SessionSummaryStatus,
  summaryMd: row.summaryMd,
  commands: (row.commands as SessionSummaryView['commands']) ?? null,
  findings: (row.findings as SessionSummaryView['findings']) ?? null,
  sourceChars: row.sourceChars,
  truncated: row.truncated,
  model: row.model,
  errorCode: row.errorCode,
  createdAt: row.createdAt.toISOString(),
  completedAt: row.completedAt ? row.completedAt.toISOString() : null,
});

@Injectable()
export class SessionSummaryService {
  private readonly logger = new Logger(SessionSummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TerminalContextService,
    private readonly jobs: JobsService,
  ) {}

  /** Asks for a summary; a request while one is already pending answers with that one. */
  async request(scope: OwnerScope, sessionId: string): Promise<SessionSummaryAccepted> {
    const { session } = await this.context.preflight(sessionId, scope, 'summary');
    if (session.status === 'terminated') {
      throw new BadRequestException({ code: SESSION_TERMINATED, message: 'A terminated session cannot be summarized.' });
    }

    await this.expireStale(scope.userId);
    const pending = await this.prisma.terminalSessionSummary.findFirst({
      where: { sessionId, userId: scope.userId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) return this.accepted(pending);

    const row = await this.prisma.terminalSessionSummary.create({
      data: { sessionId, userId: scope.userId, orgId: scope.orgId, status: 'pending' },
    });
    let job;
    try {
      job = await this.jobs.enqueue({
        type: SESSION_SUMMARIZE_TYPE,
        reason: 'rerun',
        subjectType: SESSION_SUMMARIZE_SUBJECT,
        subjectId: sessionId,
        orgId: scope.orgId,
        // Ids only: never terminal text.
        payload: { summaryId: row.id, sessionId, userId: scope.userId, orgId: scope.orgId },
      });
    } catch (err) {
      await this.prisma.terminalSessionSummary.deleteMany({ where: { id: row.id } });
      throw err;
    }

    // Dedup collapsed this request onto a job another request queued a moment ago: that job's row is
    // the one the caller should watch, and this row will never be worked.
    const queued = (job.payload as { summaryId?: string } | null)?.summaryId;
    if (queued && queued !== row.id) {
      await this.prisma.terminalSessionSummary.deleteMany({ where: { id: row.id } });
      const existing = await this.prisma.terminalSessionSummary.findFirst({
        where: { id: queued, sessionId, userId: scope.userId },
      });
      if (!existing) throw new ConflictException('A summary of this session is already being prepared. Try again shortly.');
      return this.accepted(existing);
    }

    const updated = await this.prisma.terminalSessionSummary.update({ where: { id: row.id }, data: { jobId: job.id } });
    this.logger.log('Session summary queued');
    return this.accepted(updated);
  }

  async list(scope: OwnerScope, sessionId: string): Promise<SessionSummaryView[]> {
    await this.ownSession(scope, sessionId);
    await this.expireStale(scope.userId);
    const rows = await this.prisma.terminalSessionSummary.findMany({
      where: { sessionId, userId: scope.userId },
      orderBy: { createdAt: 'desc' },
      take: SESSION_SUMMARY_LIST_LIMIT,
    });
    return rows.map(toSummaryView);
  }

  async get(scope: OwnerScope, sessionId: string, summaryId: string): Promise<SessionSummaryView> {
    await this.ownSession(scope, sessionId);
    await this.expireStale(scope.userId);
    const row = await this.prisma.terminalSessionSummary.findFirst({
      where: { id: summaryId, sessionId, userId: scope.userId },
    });
    if (!row) throw new NotFoundException('Summary not found');
    return toSummaryView(row);
  }

  private async ownSession(scope: OwnerScope, sessionId: string): Promise<void> {
    const session = await this.prisma.terminalSession.findFirst({
      where: { id: sessionId, userId: scope.userId, orgId: scope.orgId },
      select: { id: true },
    });
    if (!session) throw new NotFoundException(`Terminal session with ID ${sessionId} not found`);
  }

  /** Fails the caller's summaries whose job ended without settling them, so a client never polls forever. */
  private async expireStale(userId: string): Promise<void> {
    const now = new Date();
    await this.prisma.terminalSessionSummary.updateMany({
      where: { userId, status: 'pending', createdAt: { lt: new Date(now.getTime() - SESSION_SUMMARY_STALE_MS) } },
      data: { status: 'failed', errorCode: SUMMARY_TIMED_OUT, completedAt: now },
    });
  }

  private accepted(row: TerminalSessionSummary): SessionSummaryAccepted {
    return { summaryId: row.id, jobId: row.jobId, status: row.status as SessionSummaryStatus };
  }
}
