// =============================================================================
// The live run stream (SSE) (issue #62)
// =============================================================================
//
// `GET /api/runbook-runs/:id/logs/stream` (and `.../targets/:targetId/logs/stream` for one server). Order of
// what a client sees on connect:
//
//   1. `snapshot`  the run's status, its target and step statuses (no output);
//   2. with `Last-Event-ID: <stepRowId>:<seq>`, every chunk that arrived AFTER that one is replayed from the
//      table (if the chunk is gone, because its step was archived, every chunk still in the table is);
//   3. the live events of the `runbooks.run` bus channel for this run: `chunk`, `step`, `target`, `run`,
//      `approval`; a `heartbeat` event every 15 s keeps proxies from closing an idle stream.
//
// The bus subscription is opened BEFORE the snapshot is read, and the events that arrive meanwhile are held
// and then sent, skipping any chunk already replayed: nothing falls between the read and the live feed.
// A chunk's SSE `id` is `<stepRowId>:<seq>`. Output was redacted before it was stored or published; the
// stream adds nothing.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { runInOrg } from '@marinoscar/platform-api/core';
import { Observable } from 'rxjs';

import type { OwnerScope } from '../../common/types/owner-scope';
import { PrismaService } from '../../prisma/prisma.service';
import { chunkEventId, parseChunkEventId, type RunEvent } from './run-events';
import { RunEventsService } from './run-events.service';

export interface SseMessage {
  id?: string;
  type: string;
  data: unknown;
}

export const HEARTBEAT_MS = 15_000;

@Injectable()
export class RunStreamService {
  private readonly logger = new Logger(RunStreamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: RunEventsService,
  ) {}

  stream(scope: OwnerScope, runId: string, options: { targetId?: string; lastEventId?: string; heartbeatMs?: number }): Observable<SseMessage> {
    return new Observable<SseMessage>((subscriber) => {
      const held: RunEvent[] = [];
      let live = false;
      const seen = new Map<string, number>(); // stepRowId -> highest chunk seq already sent
      const accept = (event: RunEvent): boolean =>
        event.runId === runId && (options.targetId === undefined || !('targetId' in event) || event.targetId === options.targetId);
      const send = (event: RunEvent): void => {
        if (event.type === 'chunk') {
          if ((seen.get(event.stepRowId) ?? -1) >= event.seq) return;
          seen.set(event.stepRowId, event.seq);
          subscriber.next({ id: chunkEventId(event.stepRowId, event.seq), type: 'chunk', data: event });
        } else {
          subscriber.next({ type: event.type, data: event });
        }
      };

      const unsubscribe = this.events.subscribe((event) => {
        if (!accept(event)) return;
        if (live) send(event);
        else held.push(event);
      });
      const heartbeat = setInterval(() => subscriber.next({ type: 'heartbeat', data: {} }), options.heartbeatMs ?? HEARTBEAT_MS);
      heartbeat.unref();

      void (async () => {
        try {
          const snapshot = await this.snapshot(scope, runId, options.targetId);
          if (!snapshot) {
            subscriber.error(new Error('Run not found'));
            return;
          }
          subscriber.next({ type: 'snapshot', data: snapshot });
          const replay = await this.replay(scope, runId, options);
          for (const chunk of replay) send(chunk);
          live = true;
          for (const event of held.splice(0)) send(event);
        } catch (error) {
          this.logger.warn(`stream setup failed: ${error instanceof Error ? error.name : 'error'}`);
          subscriber.error(new Error('Stream unavailable'));
        }
      })();

      return () => {
        unsubscribe();
        clearInterval(heartbeat);
      };
    });
  }

  private snapshot(scope: OwnerScope, runId: string, targetId?: string) {
    return runInOrg(this.prisma, scope, async (tx) => {
      const run = await tx.runbookRun.findFirst({
        where: { id: runId, orgId: scope.orgId },
        select: { id: true, status: true, finishedAt: true },
      });
      if (!run) return null;
      const targets = await tx.runbookRunTarget.findMany({
        where: { runId, ...(targetId ? { id: targetId } : {}) },
        select: { id: true, status: true, errorCode: true },
      });
      const steps = await tx.runbookRunStep.findMany({
        where: { runId, ...(targetId ? { runTargetId: targetId } : {}) },
        select: { id: true, runTargetId: true, stepIndex: true, status: true, exitCode: true, durationMs: true },
      });
      return { run, targets, steps };
    });
  }

  /** The chunks after `Last-Event-ID`, oldest first, as run events. */
  private async replay(scope: OwnerScope, runId: string, options: { targetId?: string; lastEventId?: string }): Promise<RunEvent[]> {
    const ref = parseChunkEventId(options.lastEventId);
    if (!ref) return [];
    return runInOrg(this.prisma, scope, async (tx) => {
      const anchor = await tx.runbookRunLogChunk.findFirst({ where: { runStepId: ref.stepRowId, seq: ref.seq, runId }, select: { ord: true } });
      const rows = await tx.runbookRunLogChunk.findMany({
        where: {
          runId,
          ...(anchor ? { ord: { gt: anchor.ord } } : {}),
          ...(options.targetId ? { step: { runTargetId: options.targetId } } : {}),
        },
        orderBy: { ord: 'asc' },
        take: 5_000,
        include: { step: { select: { runTargetId: true, stepIndex: true } } },
      });
      return rows.map<RunEvent>((r) => ({
        type: 'chunk',
        runId,
        targetId: r.step.runTargetId,
        stepIndex: r.step.stepIndex,
        stepRowId: r.runStepId,
        seq: r.seq,
        stream: r.stream as 'stdout' | 'stderr' | 'system',
        data: r.data,
      }));
    });
  }
}
