// =============================================================================
// The sharing slice's host ports, bound to ShellKeep (issue #71)
// =============================================================================
//
//   SHARING_DATA           SharingDataAdapter (PrismaService.runInOrg, PrismaSystemService.runAsSystem)
//   SHARING_EVENT_BUS      the host core's EVENT_BUS (the membership-cache invalidation)
//   SHARING_EVENT_EMITTER  EventEmitter2 (EventEmitterModule.forRoot in app.module.ts)
//   SHARING_NOTIFIER       SharingNotifierAdapter (NotificationsService)
//   SHARING_TENANCY        TenancyService (the identity slice's OrganizationsModule)
//   SHARING_JOBS           SharingJobsAdapter (JobsService, JobHandlerRegistry)
//
// The queue, the notifications and the host core are GLOBAL modules, so they resolve here without an
// import. `SharingDataAdapter` injects the bypass client (reasons `purge`, `doctor`, `retention`,
// `link-resolution`, `invite-claim`): it is on the reviewed allowlist of
// `test/tenancy/system-injection-boundary.spec.ts`.
// =============================================================================

import { Module } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EVENT_BUS } from '@marinoscar/platform-api/host';
import { OrganizationsModule, TenancyService } from '@marinoscar/platform-api/identity';
import {
  SHARING_DATA,
  SHARING_EVENT_BUS,
  SHARING_EVENT_EMITTER,
  SHARING_JOBS,
  SHARING_NOTIFIER,
  SHARING_TENANCY,
} from '@marinoscar/platform-api/sharing';

import { SharingDataAdapter } from './sharing-data.adapter';
import { SharingJobsAdapter } from './sharing-jobs.adapter';
import { SharingNotifierAdapter } from './sharing-notifier.adapter';

const PORTS = [
  { provide: SHARING_DATA, useExisting: SharingDataAdapter },
  { provide: SHARING_EVENT_BUS, useExisting: EVENT_BUS },
  { provide: SHARING_EVENT_EMITTER, useExisting: EventEmitter2 },
  { provide: SHARING_NOTIFIER, useExisting: SharingNotifierAdapter },
  { provide: SHARING_TENANCY, useExisting: TenancyService },
  { provide: SHARING_JOBS, useExisting: SharingJobsAdapter },
];

@Module({
  imports: [OrganizationsModule],
  providers: [SharingDataAdapter, SharingNotifierAdapter, SharingJobsAdapter, ...PORTS],
  exports: PORTS.map((port) => port.provide),
})
export class SharingHostModule {}
