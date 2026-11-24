// =============================================================================
// How a running segment learns it was cancelled (issue #62)
// =============================================================================
//
// A cancel reaches a running target two ways: the `runbooks.cancel` bus message (fast, same or other
// replica) and a poll of the run and target rows every `CANCEL_POLL_MS` (2 s), which is the guarantee: a
// lost bus message costs at most one poll. Either aborts the signal the executor listens to; the executor
// then sends INT, and KILL ten seconds later.
// =============================================================================

import { runInOrg } from '@marinoscar/platform-api/core';

import { PrismaService } from '../../prisma/prisma.service';
import { CANCEL_POLL_MS } from './engine.constants';
import type { RunEventsService } from './run-events.service';

export class CancelWatch {
  private readonly controller = new AbortController();
  private timer: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;
  private polling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: RunEventsService,
    private readonly orgId: string,
    private readonly runId: string,
    private readonly targetId: string,
    private readonly pollMs: number = CANCEL_POLL_MS,
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  start(): this {
    this.unsubscribe = this.events.subscribeCancel((message) => {
      if (message.runId === this.runId && (message.targetId === undefined || message.targetId === this.targetId)) this.controller.abort();
    });
    this.timer = setInterval(() => void this.poll(), this.pollMs);
    this.timer.unref();
    return this;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.unsubscribe?.();
  }

  /** One check of the rows. A fault is ignored: the next poll tries again. */
  async poll(): Promise<void> {
    if (this.polling || this.controller.signal.aborted) return;
    this.polling = true;
    try {
      const cancelled = await runInOrg(this.prisma, { orgId: this.orgId }, async (tx) => {
        const [run, target] = await Promise.all([
          tx.runbookRun.findUnique({ where: { id: this.runId }, select: { status: true } }),
          tx.runbookRunTarget.findUnique({ where: { id: this.targetId }, select: { cancelRequestedAt: true, status: true } }),
        ]);
        return (
          run?.status === 'cancelling' ||
          run?.status === 'cancelled' ||
          target?.cancelRequestedAt != null ||
          target?.status === 'cancelled'
        );
      });
      if (cancelled) this.controller.abort();
    } catch {
      // the next poll tries again
    } finally {
      this.polling = false;
    }
  }
}
