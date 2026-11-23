// =============================================================================
// The jobs and nodes slices, configured once (issue #49)
// =============================================================================
//
// `JobsModule` and `NodesModule` here are the CONFIGURED dynamic modules of
// `@marinoscar/platform-api/jobs` and `/nodes`, built once at import time:
// every app module that needs the queue imports this one object, so there is
// exactly one queue (the module is also global). The environment
// (`JOBS_*`, `NODE_*_ENABLED`) stays the deployment's configuration.
//
// The app's namespace manifest loads FIRST: each `forRoot()` registers its
// slice's settings namespace (`jobs`, `nodes`) unless the manifest already did,
// and `platform/settings/registry.ts` lists them in the stored key order.
// =============================================================================

import '../settings/registry';

import { JobsModule as PlatformJobsModule, registerJobReason } from '@marinoscar/platform-api/jobs';
import { NodeCredentialModule, NodesModule as PlatformNodesModule, registerNodeSpanAttribute } from '@marinoscar/platform-api/nodes';

import { APP_JOB_REASONS, APP_NODE_SPAN_ATTRIBUTES } from '../../app-registrations/jobs';
import { JobsHostModule } from './jobs-host.module';

for (const reason of APP_JOB_REASONS) registerJobReason(reason);
for (const attribute of APP_NODE_SPAN_ATTRIBUTES) registerNodeSpanAttribute(attribute);

/** The queue: `JobsModule.forRoot()` with the app's name (the temp-file prefix) and its host ports. */
export const jobsModule = PlatformJobsModule.forRoot({ appName: 'shellkeep', imports: [JobsHostModule] });

/** The worker-node fleet: `NodesModule.forRoot()` with the app's host ports. */
export const nodesModule = PlatformNodesModule.forRoot({ imports: [JobsHostModule] });

/** The `nod_` credential family and `/api/node-credentials`; global, it backs `IDENTITY_NODE_CREDENTIALS`. */
export const nodeCredentialModule = NodeCredentialModule;
