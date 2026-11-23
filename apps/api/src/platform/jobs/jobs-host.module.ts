// =============================================================================
// The jobs and nodes slices' host ports, bound to ShellKeep (issue #49)
// =============================================================================
//
// `@Global()`, passed to `JobsModule.forRoot({ imports })` and
// `NodesModule.forRoot({ imports })` (./jobs.config.ts):
//
//   JOBS_METRICS       -> AppMetricsService   (the `app.jobs.*` instruments)
//   JOBS_EVENT_BUS     -> EVENT_BUS           (the cross-replica wake-up)
//   NODE_OBJECT_STORE  -> refusing stand-in   PLATFORM-ADOPTION-SHIM(#50)
//   NODE_JOB_INPUTS    -> refusing stand-in   PLATFORM-ADOPTION-SHIM(#50)
//
// `JOBS_ORG_SCOPE` is not bound: ShellKeep tracks no ambient organization, so a
// job enqueued without `orgId` is a system job.
// =============================================================================

import { Global, Module } from '@nestjs/common';
import { AppMetricsService, EVENT_BUS } from '@marinoscar/platform-api/host';
import { JOBS_EVENT_BUS, JOBS_METRICS } from '@marinoscar/platform-api/jobs';
import { NODE_JOB_INPUTS, NODE_OBJECT_STORE } from '@marinoscar/platform-api/nodes';

import { NoNodeJobInputs, NoNodeObjectStore } from './node-ports.shim';

const BINDINGS = [
  { provide: JOBS_METRICS, useExisting: AppMetricsService },
  { provide: JOBS_EVENT_BUS, useExisting: EVENT_BUS },
  { provide: NODE_OBJECT_STORE, useClass: NoNodeObjectStore },
  { provide: NODE_JOB_INPUTS, useClass: NoNodeJobInputs },
];

@Global()
@Module({
  providers: BINDINGS,
  exports: BINDINGS.map((binding) => binding.provide),
})
export class JobsHostModule {}
