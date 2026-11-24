// =============================================================================
// Raising ShellKeep's webhook events (issue #54)
// =============================================================================
//
// One place that builds each payload and calls `WebhooksService.emit`, so a call site
// is a single line and no payload is assembled from a row by hand elsewhere.
//
// EVERY METHOD MUST BE CALLED AFTER THE TRIGGERING WRITE COMMITS, outside any
// `$transaction` (`emit` opens its own short transaction and makes no HTTP request;
// the delivery is a queue job). None of them ever throws: a webhook must not fail or
// roll back the action that raised it, so a failure is logged by name only.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import { WebhooksService } from '@marinoscar/platform-api/webhooks';

import {
  TERMINAL_WEBHOOK_EVENTS,
  type HostKeyChangedData,
  type SessionCreatedData,
  type SessionTerminatedData,
  type SessionTerminationReason,
} from './terminal.webhook-events';

/** Who the event is about: the owner of the session or the profile, in their organization. */
export interface WebhookOwner {
  userId: string;
  orgId: string;
}

@Injectable()
export class TerminalWebhooksService {
  private readonly logger = new Logger(TerminalWebhooksService.name);

  constructor(private readonly webhooks: WebhooksService) {}

  /** `terminal.session.created`, after the session row was written. */
  async sessionCreated(
    owner: WebhookOwner,
    session: { id: string; serverProfileId: string; createdAt: Date },
    serverProfileName: string,
  ): Promise<void> {
    const data: SessionCreatedData = {
      sessionId: session.id,
      serverProfileId: session.serverProfileId,
      serverProfileName,
      createdAt: session.createdAt.toISOString(),
    };
    await this.emit(TERMINAL_WEBHOOK_EVENTS.SESSION_CREATED, data, owner, session.createdAt);
  }

  /** `terminal.session.terminated`, after the session was marked terminated. */
  async sessionTerminated(
    owner: WebhookOwner,
    session: { id: string; serverProfileId: string },
    reason: SessionTerminationReason,
    terminatedAt: Date,
  ): Promise<void> {
    const data: SessionTerminatedData = {
      sessionId: session.id,
      serverProfileId: session.serverProfileId,
      reason,
      terminatedAt: terminatedAt.toISOString(),
    };
    await this.emit(TERMINAL_WEBHOOK_EVENTS.SESSION_TERMINATED, data, owner, terminatedAt);
  }

  /** `server_profile.host_key_changed`, after a DIFFERENT trusted key was replaced (#60). */
  async hostKeyChanged(
    owner: WebhookOwner,
    change: { serverProfileId: string; previousFingerprint: string; presentedFingerprint: string },
    detectedAt: Date = new Date(),
  ): Promise<void> {
    const data: HostKeyChangedData = {
      serverProfileId: change.serverProfileId,
      previousFingerprint: change.previousFingerprint,
      presentedFingerprint: change.presentedFingerprint,
      detectedAt: detectedAt.toISOString(),
    };
    await this.emit(TERMINAL_WEBHOOK_EVENTS.HOST_KEY_CHANGED, data, owner, detectedAt);
  }

  private async emit(eventKey: string, data: object, owner: WebhookOwner, occurredAt: Date): Promise<void> {
    try {
      await this.webhooks.emit(eventKey, data as Record<string, unknown>, {
        orgId: owner.orgId,
        userId: owner.userId,
        occurredAt,
      });
    } catch (error) {
      this.logger.warn(`Could not raise webhook event ${eventKey}: ${error instanceof Error ? error.name : 'error'}`);
    }
  }
}
