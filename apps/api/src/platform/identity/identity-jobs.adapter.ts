import { Injectable, Logger } from '@nestjs/common';
import type { IdentityJobHandler, IdentityJobsPort } from '@marinoscar/platform-api/identity';

/**
 * Identity's `IDENTITY_JOBS`, without a queue.
 *
 * PLATFORM-ADOPTION-SHIM(#49): ShellKeep has no job queue until #49. The
 * identity slice registers its two housekeeping handlers (`auth.token.cleanup`
 * and `auth.device-code.cleanup`) with `registerHandler` and its enqueue-only
 * crons call `enqueueHousekeepingJob`; with no queue to hold the job, this
 * adapter runs the registered handler in-process, once at a time per type. Both
 * handlers are idempotent deletes of expired credential rows (the work the old
 * `token-cleanup` and `device-code-cleanup` crons did inline). #49 replaces this
 * class with the platform's `JobsService` and `JobHandlerRegistry`. See
 * docs/platform-adoption/local-exceptions.md.
 *
 * Never throws: a failure is logged on the caller's logger, as the port asks.
 */
@Injectable()
export class IdentityJobsAdapter implements IdentityJobsPort {
  private readonly handlers = new Map<string, IdentityJobHandler>();
  private readonly running = new Set<string>();

  registerHandler(handler: IdentityJobHandler): void {
    this.handlers.set(handler.type, handler);
  }

  async enqueueHousekeepingJob(options: { type: string; what: string; logger: Logger }): Promise<void> {
    const { type, what, logger } = options;
    const handler = this.handlers.get(type);
    if (!handler) {
      logger.warn(`No handler registered for ${type}; skipping ${what}`);
      return;
    }
    if (this.running.has(type)) {
      logger.log(`Skipping ${what}: one is already running`);
      return;
    }
    this.running.add(type);
    try {
      await handler.process({ id: `inline-${type}` });
    } catch (error) {
      logger.error(
        `Failed to run ${what}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running.delete(type);
    }
  }
}
