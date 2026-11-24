// =============================================================================
// The Home dashboard summary: the wire shape of `GET /api/dashboard/summary` (issue #78)
// =============================================================================
//
// One read answers the three questions of the Home page: which servers are unhealthy, what is
// running right now and what failed recently. Every count is over what the CALLER may see, and
// every list is at most `DASHBOARD_RECENT_LIMIT` rows.
// =============================================================================

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** How many rows each `recent` list carries. The query cost is counts plus `LIMIT` this. */
export const DASHBOARD_RECENT_LIMIT = 5;

/** The window of `runs.failedLast24h`. */
export const DASHBOARD_FAILED_WINDOW_MS = 24 * 60 * 60 * 1000;

export const dashboardServersSchema = z
  .object({
    total: z.number().int().min(0).describe('Server profiles the caller may see: owned, owned by a group of theirs, or shared with them'),
    reachable: z.number().int().min(0).describe('Servers whose last stored connection test succeeded'),
    unreachable: z.number().int().min(0).describe('Servers whose last stored connection test failed'),
    unknown: z
      .number()
      .int()
      .min(0)
      .describe('Servers with no stored connection-test result. The dashboard never opens SSH itself.'),
    hostKeyUntrusted: z.number().int().min(0).describe('Servers with no trusted host-key fingerprint yet'),
  })
  .describe('Fleet health. `null` when the caller lacks `servers:read`.');

export const sessionSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.enum(['active', 'detached']).describe('`active`: a client is attached; `detached`: tmux keeps it running'),
  serverProfileId: z.string().uuid(),
  serverName: z.string(),
  lastActivityAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export const dashboardSessionsSchema = z.object({
  active: z.number().int().min(0).describe("The caller's sessions that are not terminated (attached or detached)"),
  attached: z.number().int().min(0).describe('Of `active`, those with a client attached'),
  detached: z.number().int().min(0).describe('Of `active`, those running with no client attached'),
  recent: z
    .array(sessionSummarySchema)
    .max(DASHBOARD_RECENT_LIMIT)
    .describe('The most recently used non-terminated sessions, newest first'),
});

export const runTargetCountsSchema = z.object({
  total: z.number().int().min(0),
  succeeded: z.number().int().min(0),
  failed: z.number().int().min(0),
  running: z.number().int().min(0),
});

export const runSummarySchema = z.object({
  id: z.string().uuid(),
  runbookId: z.string().uuid(),
  runbookName: z.string(),
  status: z.string().describe('The run status the runbook engine reports (for example `running`, `succeeded`, `failed`)'),
  targets: runTargetCountsSchema,
  startedAt: z.iso.datetime().nullable(),
});

export const dashboardRunsSchema = z
  .object({
    running: z.number().int().min(0),
    failedLast24h: z.number().int().min(0),
    recent: z.array(runSummarySchema).max(DASHBOARD_RECENT_LIMIT),
  })
  .describe('Runbook runs. `null` when the caller lacks `runbooks:read`, or while the deployment records no runs.');

export const dashboardSummarySchema = z.object({
  servers: dashboardServersSchema.nullable(),
  sessions: dashboardSessionsSchema,
  runs: dashboardRunsSchema.nullable(),
});

export type DashboardServers = z.infer<typeof dashboardServersSchema>;
export type DashboardSessions = z.infer<typeof dashboardSessionsSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type RunSummary = z.infer<typeof runSummarySchema>;
export type DashboardRuns = z.infer<typeof dashboardRunsSchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export class DashboardSummaryDto extends createZodDto(dashboardSummarySchema) {}
