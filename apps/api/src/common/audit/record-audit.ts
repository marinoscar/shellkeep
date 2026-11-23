import type { Logger } from '@nestjs/common';
import type { AuditEventInput, AuditSink } from '@marinoscar/platform-api/core';

/**
 * Records an audit event through the platform's `AUDIT_SINK`, after the
 * triggering write committed. An audit failure is logged and swallowed: a
 * missing audit row must never fail (or roll back) the action it describes.
 * `meta` is scalars only and never carries a credential, token or terminal
 * payload; callers pass a hostname, an id or a flag.
 */
export async function recordAudit(
  sink: AuditSink,
  logger: Logger,
  event: AuditEventInput,
): Promise<void> {
  try {
    await sink.record(event);
  } catch (error) {
    logger.warn(
      `Audit event ${event.action} was not recorded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
