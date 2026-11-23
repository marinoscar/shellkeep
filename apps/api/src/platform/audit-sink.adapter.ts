import { Injectable } from '@nestjs/common';
import type { AuditEventInput, AuditSink } from '@marinoscar/platform-api/core';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * The platform's `AUDIT_SINK` over ShellKeep's `audit_events` table.
 *
 * Packaged slices and ShellKeep's own routes report audit events here after the
 * triggering write has committed. `meta` carries scalars only (the port's
 * contract), so it is stored as given.
 */
@Injectable()
export class PrismaAuditSink implements AuditSink {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEventInput): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: event.actorUserId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        ...(event.meta === undefined ? {} : { meta: event.meta as Prisma.InputJsonValue }),
      },
    });
  }
}
