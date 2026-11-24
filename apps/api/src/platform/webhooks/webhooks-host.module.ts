// =============================================================================
// The webhooks slice's host port (issue #54)
// =============================================================================
//
//   WEBHOOKS_SYSTEM_PRISMA  PrismaSystemService: the bypass client. A system-scope
//                           endpoint (and its deliveries) has no organization, so
//                           row-level security shows it to the bypass client only.
//                           Registered reasons: `webhooks` (every system-scope query
//                           and the delivery job's reads of them) and `retention`
//                           (the delivery purge across organizations).
//
// PLATFORM_PRISMA, AUDIT_SINK, JobsService, the credential stores and the
// notifications come from the app's global modules. `PrismaSystemService` is a
// SEPARATE pool whose every transaction sets the transaction-local
// `app.rls_bypass` flag; the tenant pool never carries it.
//
// This file is on the reviewed allowlist of
// `test/tenancy/system-injection-boundary.spec.ts`.
// =============================================================================

import { Module } from '@nestjs/common';
import { WEBHOOKS_SYSTEM_PRISMA, type WebhooksSystemPrisma } from '@marinoscar/platform-api/webhooks';

import { PrismaSystemService } from '../../prisma/prisma-system.service';

/** Binds `WEBHOOKS_SYSTEM_PRISMA` to the app's bypass client. */
@Module({
  providers: [
    {
      provide: WEBHOOKS_SYSTEM_PRISMA,
      inject: [PrismaSystemService],
      useFactory: (system: PrismaSystemService): WebhooksSystemPrisma => ({
        asSystem: (reason) => system.forSystem(reason) as unknown as ReturnType<WebhooksSystemPrisma['asSystem']>,
        runAsSystem: (reason, fn, options) =>
          system.runAsSystem(reason, fn as unknown as Parameters<typeof system.runAsSystem>[1], options) as never,
      }),
    },
  ],
  exports: [WEBHOOKS_SYSTEM_PRISMA],
})
export class WebhooksHostModule {}
