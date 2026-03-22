import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SessionCleanupTask {
  private readonly logger = new Logger(SessionCleanupTask.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 */5 * * * *')
  async handleCleanup(): Promise<void> {
    await this.markStaleSessions();
    await this.terminateStaleDetachedSessions();
    await this.purgeOldTerminatedSessions();
  }

  private async markStaleSessions(): Promise<void> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const result = await this.prisma.terminalSession.updateMany({
      where: {
        status: 'active',
        lastActivityAt: { lt: oneHourAgo },
      },
      data: {
        status: 'detached',
      },
    });

    if (result.count > 0) {
      this.logger.log(`Marked ${result.count} stale sessions as detached`);
    }
  }

  private async terminateStaleDetachedSessions(): Promise<void> {
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);

    const result = await this.prisma.terminalSession.updateMany({
      where: {
        status: 'detached',
        lastActivityAt: { lt: twelveHoursAgo },
      },
      data: {
        status: 'terminated',
        terminatedAt: new Date(),
      },
    });

    if (result.count > 0) {
      this.logger.log(
        `Terminated ${result.count} stale detached sessions`,
      );
    }
  }

  private async purgeOldTerminatedSessions(): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const result = await this.prisma.terminalSession.deleteMany({
      where: {
        status: 'terminated',
        terminatedAt: { lt: thirtyDaysAgo },
      },
    });

    if (result.count > 0) {
      this.logger.log(`Purged ${result.count} old terminated sessions`);
    }
  }
}
