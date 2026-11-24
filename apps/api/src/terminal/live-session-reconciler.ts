import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionManagerService } from './session-manager.service';

/**
 * Closes the live SSH streams whose session row no longer allows them: the row is gone (a user-data
 * purge deleted it) or `terminated` (a factory reset marked it inside its own transaction, with no
 * access to the manager). One read for every live id, then `terminateSession` for each stale one.
 * Never throws: a failed read or close is logged, and the rest still run. It never kills remote tmux.
 */
@Injectable()
export class LiveSessionReconciler {
  private readonly logger = new Logger(LiveSessionReconciler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly manager: SessionManagerService,
  ) {}

  /** @returns how many live streams were closed. */
  async reconcile(): Promise<number> {
    let closed = 0;
    try {
      const live = this.manager.liveSessionIds();
      if (live.length === 0) return 0;
      const rows = await this.prisma.terminalSession.findMany({
        where: { id: { in: live } },
        select: { id: true, status: true },
      });
      const status = new Map<string, string>(rows.map((r) => [r.id, r.status as string]));
      for (const id of live) {
        const current = status.get(id);
        if (current !== undefined && current !== 'terminated') continue;
        try {
          await this.manager.terminateSession(id);
          closed += 1;
        } catch (err) {
          this.logger.error(`Failed to close live session ${id}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.error(`Live session reconcile failed: ${(err as Error).message}`);
    }
    if (closed > 0) this.logger.log(`Closed ${closed} live session(s) whose row no longer allows them`);
    return closed;
  }
}
