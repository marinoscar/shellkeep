// =============================================================================
// The schedules tick passes the platform's handler conformance (issue #66)
// =============================================================================
//
// A dotted type, a label, a profile of only `maxRuntimeMs` and `maxAttempts`, no node members (server-only), and
// an idempotent no-op pass over a database with no due schedule. The behaviour proper (firing, overlap, races,
// DST, permissions) is `test/runbooks/runbook-schedules.db.spec.ts`.
// =============================================================================

import { describeJobHandlerConformance } from '@marinoscar/platform-api/jobs/testing';
import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';

import { RunbookSchedulesTickHandler } from './runbook-schedules-tick.handler';

const none = new Proxy({}, { get: () => async () => undefined }) as never;
const system = { runAsSystem: async () => [] } as never;

describeJobHandlerConformance('runbook.schedules.tick', () => new RunbookSchedulesTickHandler(new JobHandlerRegistry(), none, system, none, none, none, none, none), {
  payloads: [{ name: 'a tick with nothing due changes nothing', payload: null, orgId: null, reason: 'runbook_run' }],
});
