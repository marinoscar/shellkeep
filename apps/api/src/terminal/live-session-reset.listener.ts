// =============================================================================
// A reset or purge job settled: close the live streams its rows no longer allow (#145)
// =============================================================================
//
// `@OnEvent(JOB_SETTLED_EVENT)`, filtered to the platform's factory-reset, user-data-purge and
// org-offboard jobs that SUCCEEDED. It only hands off to `LiveSessionReconciler` (one short read and
// in-memory closes: no download, upload or spawn; `on-event-no-io`). It never throws.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JOB_SETTLED_EVENT, type JobSettledEvent } from '@marinoscar/platform-api/jobs';
import {
  FACTORY_RESET_JOB_TYPE,
  ORG_OFFBOARD_JOB_TYPE,
  USER_DATA_PURGE_JOB_TYPE,
} from '@marinoscar/platform-contract/user-data';
import { LiveSessionReconciler } from './live-session-reconciler';

const RESET_JOB_TYPES: ReadonlySet<string> = new Set([
  FACTORY_RESET_JOB_TYPE,
  USER_DATA_PURGE_JOB_TYPE,
  ORG_OFFBOARD_JOB_TYPE,
]);

@Injectable()
export class LiveSessionResetListener {
  private readonly logger = new Logger(LiveSessionResetListener.name);

  constructor(private readonly reconciler: LiveSessionReconciler) {}

  @OnEvent(JOB_SETTLED_EVENT)
  async handle(event: JobSettledEvent): Promise<void> {
    try {
      if (!RESET_JOB_TYPES.has(event.type) || !event.succeeded) return;
      await this.reconciler.reconcile();
    } catch (err) {
      this.logger.error(`Live session reconcile after ${event.type} failed: ${(err as Error).message}`);
    }
  }
}
