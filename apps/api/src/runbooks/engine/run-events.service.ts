import { Inject, Injectable, Logger } from '@nestjs/common';
import { EVENT_BUS } from '@marinoscar/platform-api/host';
import type { EventBus } from '@marinoscar/platform-api/host';

import { RUNBOOK_CANCEL_CHANNEL, RUNBOOK_RUN_CHANNEL } from './engine.constants';
import type { RunCancelMessage, RunEvent } from './run-events';

/**
 * The runbook engine's side of the event bus: publishes run events and cancel requests, and lets the SSE
 * stream and the running segments subscribe. NEVER THROWS: a bus fault (or an oversize payload) must not
 * fail a step or a job, the database is the source of truth and the stream replays from it.
 */
@Injectable()
export class RunEventsService {
  private readonly logger = new Logger(RunEventsService.name);

  constructor(@Inject(EVENT_BUS) private readonly bus: EventBus) {}

  async publish(event: RunEvent): Promise<void> {
    try {
      await this.bus.publish(RUNBOOK_RUN_CHANNEL, event);
    } catch (error) {
      this.logger.warn(`run event not published (${event.type}): ${error instanceof Error ? error.name : 'error'}`);
    }
  }

  async publishAll(events: readonly RunEvent[]): Promise<void> {
    for (const event of events) await this.publish(event);
  }

  async publishCancel(message: RunCancelMessage): Promise<void> {
    try {
      await this.bus.publish(RUNBOOK_CANCEL_CHANNEL, message);
    } catch (error) {
      this.logger.warn(`cancel message not published: ${error instanceof Error ? error.name : 'error'}`);
    }
  }

  /** Subscribes to every run event; returns the unsubscribe. */
  subscribe(handler: (event: RunEvent) => void): () => void {
    return this.bus.subscribe<RunEvent>(RUNBOOK_RUN_CHANNEL, (event) => handler(event));
  }

  subscribeCancel(handler: (message: RunCancelMessage) => void): () => void {
    return this.bus.subscribe<RunCancelMessage>(RUNBOOK_CANCEL_CHANNEL, (message) => handler(message));
  }
}
