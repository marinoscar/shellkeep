---
name: add-job-type
description: Add a background job type to the job queue - implement a JobHandler, self-register it, enqueue it through JobsService with an explicit orgId, declare its label and execution profile, decide node eligibility, and add the tests that pin it. Use when a feature must do long-running work (a runbook step over SSH, a session summary, an export, a sweep), when adding an ai.* job, or when a @Cron or @OnEvent body would otherwise work inline.
---

# Add a job type

**In force since #49** (jobs and nodes adopted from the platform). The reference is `apps/api/src/terminal/jobs/session-reap.handler.ts` with its enqueue-only cron `apps/api/src/terminal/tasks/session-cleanup.task.ts`; do not add a second hand-rolled scheduler.

The queue and the worker-node fleet are the platform's: `@marinoscar/platform-api/jobs` and `@marinoscar/platform-api/nodes`. ShellKeep owns handlers and their host ports (`apps/api/src/platform/jobs/`). Read the contract in the installed package: the jobs section of `node_modules/@marinoscar/platform-api/README.md` and the TSDoc in `node_modules/@marinoscar/platform-api/dist/jobs/job-handler.interface.d.ts`. Rule: root `AGENTS.md`, "Every Long-Running Activity Is a Queue Job".

## Imports

```ts
import {
  JobHandlerRegistry, JobsService, JobScope,
  enqueueHousekeepingJob, RateLimitError,
  type Job, type JobHandler,
} from '@marinoscar/platform-api/jobs';
```

## Steps

1. Create the handler beside the feature (`apps/api/src/terminal/...`, `apps/api/src/runbooks/...`): a class implementing `JobHandler` with a dotted, lowercase `type` (for example `runbook.step.exec`), a `label` (sentence case, sized for a table cell) and `process(job)`. Throw to fail; a normal return means the work committed. Be idempotent: the queue is at-least-once.
2. Self-register in `onModuleInit`: `this.registry.register(this)` with an injected `JobHandlerRegistry`; add the class to the feature module's `providers`.
3. Enqueue through `JobsService.enqueue` (or `enqueueWithin(tx, ...)`) with identifiers in `payload`, never copies of data and never a credential. **Pass `orgId` explicitly on every enqueue**: `null` for housekeeping and system jobs, the organization id for a job whose handler touches org tables. Run such work under `JobScope.run(job, fn)`.
4. A `@Cron` only decides whether work is due and enqueues, through `enqueueHousekeepingJob`. An `@OnEvent` body enqueues; it never connects, downloads or spawns.
5. Labels: a live handler declares `label` itself. Only a retired type registers one with `registerJobTypeLabel` in `apps/api/src/app-registrations/jobs.ts`.
6. Add a handler spec. Append the type string to the snapshot in `apps/api/test/jobs/job-type-snapshot.spec.ts` . The `cron-enqueue-only` and `on-event-no-io` conformance suites must still pass.

## Rules

- A job `type` string is permanent once jobs of that type exist; a rename is a new type.
- Interactive terminal I/O (WebSocket, tmux attach) is not a job. Anything that outlives the request, message or tick is. No detached `void this.doIt()`. The three permanent exemptions are the platform's lease reaper, temp-file janitor and node-secret sweep; never add a fourth.
- **SSH-executing jobs are server-only.** SSH credentials are never brokered to a node and never enter a payload. Host keys are verified before any command runs (#60) through the shared connection factory. Do not provide `nodeResultSchema`/`persistNodeResult` for them.
- Node eligibility is the default for other types: provide both `nodeResultSchema` and `persistNodeResult` unless the handler writes as it goes, reads several tables mid-computation or needs a privilege a node must never hold. Never provide only one. A per-job secret is declared with `nodeSecretBroker`.
- `profile` is optional and exactly `{ maxRuntimeMs, maxAttempts }`. Never add `leaseMs` or `heartbeatMs`.
- `ai.*` jobs (for example `ai.session.summarize`) are server-only permanently, spend the requesting user's key, and send terminal output to a model only after redaction and only when the server profile allows it (root AI rule 6). Use `profile.maxAttempts: 1` when a retry would double-bill.
- A provider or SSH call that can be throttled throws `RateLimitError` so the queue defers instead of failing.
- A job that re-enqueues itself for the same subject needs `skipDedup: true`.
- Send notifications after the job's write commits, outside any `$transaction`.
- No migration is needed: `jobs.type` is a plain string.

## Verify

```bash
cd apps/api && npm run typecheck && npm test
```

Flag the new type for the docs agent (job-type inventory in `docs/ARCHITECTURE.md`).
