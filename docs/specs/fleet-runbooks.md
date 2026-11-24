# Fleet Runbooks

> **Audience:** developers · Code: `apps/api/src/runbooks/`, `apps/api/src/command-safety/`, `apps/web/src/pages/runbooks/` · Related: [ARCHITECTURE.md §3.6](../ARCHITECTURE.md#36-fleet-runbooks), [SECURITY-ARCHITECTURE.md §7](../SECURITY-ARCHITECTURE.md#7-runbook-safety), [terminal-ai.md](terminal-ai.md), [runbooks/ssh-secret-reencryption.md](../runbooks/ssh-secret-reencryption.md)

## 1. Purpose

A **runbook** is a reusable, versioned, multi-step procedure that ShellKeep runs over SSH against many servers at once (patch a fleet, rotate a config, collect logs, let an AI agent diagnose a host), with live logs, per-server results, approvals for risky work and a full audit trail. This spec defines the definition model, the run engine, logs and artifacts, safety, the AI step, and the invariants. **Schedules** (running a runbook on a cron timer) are [§9](#9-schedules).

## 2. Model

### 2.1 Runbooks and versions

`runbooks` (organization-owned; `owner_user_id` is the author, null when that user is deleted; optional `owner_group_id`) hold name (unique per organization among live runbooks, case-insensitive: `runbooks_org_name_live_uniq_idx`), description, tags, `latest_version_id` and `archived_at`. `runbook_versions` are **immutable**: `PUT /api/runbooks/:id/definition` appends the next version (a definition identical to the latest creates none) and needs `If-Match: "v<n>"`; no code path updates or deletes a version except the cascade of a permanent delete. A version stores the `definition` JSONB, its `definition_sha256` and a changelog. Archive (`DELETE /api/runbooks/:id`) and restore are soft; permanent delete (`DELETE .../permanent`) is refused while runs are active (`RUNBOOK_HAS_ACTIVE_RUNS`). Visibility follows sharing: a runbook is private to its owner until shared (roles `viewer` < `runner` < `editor`), and runs need `connect` on each target on top ([SECURITY-ARCHITECTURE.md §5](../SECURITY-ARCHITECTURE.md#5-authorization)).

### 2.2 Definition (`schemaVersion: 1`)

Validated by `runbookDefinitionSchema` (`schema/runbook-definition.schema.ts`, Zod; patterns compiled with RE2):

| Part | Rules |
|---|---|
| `parameters` (at most 30) | `name`, type `string`, `number`, `boolean`, `enum` or `secret`; `required`, `default`, `pattern` (string only, RE2), `options` (enum only). A `secret` parameter has **no default** and no value in the definition |
| `steps` (1 to 50) | unique ids `^[a-z][a-z0-9_-]{0,47}$`; common fields `name`, `when` (`on_success`, `on_failure`, `always`), `continueOnError`, `timeoutSec` (1 to 14,400, default 600) |
| `defaultTargets` | `serverIds`, `tags.any`, `tags.all`, `groupIds` (reserved: answers 422 `RUNBOOK_TARGET_GROUPS_UNAVAILABLE`), `exclude` |
| `strategy` | `concurrency` (1 to 50, default 5), `batchSize`, `maxFailures` (`{count}` or `{percent}`, default `{count: 0}` = fail fast), `abortInFlight`, `pauseAfterFirstBatch` (canary) |

The summed `timeoutSec` of the steps between two pause points must fit one segment's 4-hour budget (`MAX_SEGMENT_TIMEOUT_SEC`). The schema also yields **warnings** (never blocking) and a **risk assessment** ([§6](#6-safety)); `POST /api/runbooks/validate` returns both without saving.

### 2.3 Step kinds

<!-- step-kinds:start -->
| Kind | What it does |
|---|---|
| `command` | one shell command (max 8,192 chars), optional `workdir`, `runAs { sudo, user }`, `successExitCodes` |
| `script` | a script body (max 64 KiB) in `bash`, `sh` or `python3` with `args` |
| `package_update` | update named packages or `all` with the detected manager (`auto`, `apt`, `dnf`, `yum`, `apk`, `zypper`, `brew`), `refreshIndex`, `securityOnly` |
| `file_upload` | copy a stored object (`storageObjectId`) to `destPath` with `mode`, `owner`, `overwrite`; verified by checksum |
| `collect_logs` | tar the given `paths` (globs) and systemd `journalUnits` since a window, size-capped, redacted, stored as an artifact |
| `ai_task` | an AI agent works toward a `goal` with `approvalMode` `per_command`, `plan` or `autonomous_within_allowlist`, `allow`/`deny` RE2 patterns, `tools` (`run_command`, `read_file`, `list_dir`), `maxSteps` (1 to 20), `maxOutputTokens`, `commandTimeoutSec` |
| `approval_gate` | pause the run (`scope: run`) or each target (`scope: target`) until a person with `runbooks:approve` decides; `message`, `expiresAfterSec` (60 s to 7 days) |
<!-- step-kinds:end -->

`approval_gate` and `ai_task` are **pause points**: they cut a target's steps into segments.

### 2.4 Targets

`POST /api/runbooks/targets/preview` and the run itself resolve the selector (`target-resolver.service.ts`): the union of `serverIds`, tag matches and group members, minus `exclude`; partitioned by access (a server the caller cannot `connect` to becomes a **skipped** target `FORBIDDEN`, visible in the matrix, never silently dropped; a server matched only by tag is considered only if the caller may read it); sorted by name then id so batching is deterministic; capped at `runbooks.maxTargetsPerRun`.

### 2.5 Runs

A run (`runbook_runs`) fixes a `version`, `params` (non-secret values only), `secret_refs` (parameter to the **name** of an organization secret), the resolved `target_selector` and `strategy`, `trigger` (`manual`, `api`, `schedule`), `dry_run`, `destructive`, `initiated_by`. It **snapshots** each target's name, host, port, user and trusted fingerprint on the target row, so history survives a profile being edited or deleted. Statuses (CHECK-constrained in SQL, mirrored by `engine/state-machine.ts`):

<!-- run-statuses:start -->
`queued`, `resolving`, `running`, `paused`, `cancelling`, `succeeded`, `failed`, `partially_failed`, `aborted`, `cancelled`
<!-- run-statuses:end -->

Target statuses: `pending`, `queued`, `running`, `waiting`, `succeeded`, `failed`, `skipped`, `cancelled`. Step statuses: `pending`, `running`, `waiting_approval`, `succeeded`, `failed`, `skipped`, `timed_out`, `cancelled`. Every status write goes through `assertTransition`; an illegal move is a loud error, not a drifting row.

## 3. Execution engine

### 3.1 Jobs

| Job type | Role | Notes |
|---|---|---|
| `runbook.run.start` | resolves targets as the **initiator**, snapshots, inserts targets and pending step rows, moves the run to `running`, calls `advance`, all in one transaction | idempotent |
| `runbook.target.run` | runs **one segment** on **one server** over one SSH connection | server-only, `maxAttempts: 1`, max 4 h |
| `runbook.run.advance` | calls the coordinator for a run; enqueued when a run job settles and by the sweep | deduplicated per run |
| `runbook.logs.compact` | the reconcile sweep, a system job queued every minute by an enqueue-only cron | idempotent |
| `runbook.schedules.tick` | fires due schedules ([§9](#9-schedules)), a system job queued every minute by an enqueue-only cron | idempotent per tick |
| `ai.runbook.agent` | one `ai_task` step on one target | server-only, `maxAttempts: 1` |
| `runbook.artifacts.bundle`, `runbook.artifacts.purge` | zip a run's logs; retention purge | |

The **coordinator** (`run-coordinator.service.ts`) is the one place a run moves forward. `advance(tx, runId)` runs inside the caller's organization transaction, takes `SELECT ... FOR UPDATE` on the run (two replicas take turns), asks the pure planner `planAdvance` (`run-plan.ts`) what to change, applies it and enqueues each `runbook.target.run` **through the same transaction**: a target is `queued` if and only if its job exists. It publishes nothing; events, notifications and the in-process "run finished" event leave after commit (`RunLifecycleService.afterCommit`, which never throws).

The planner: (1) cancels pending and parked targets when `cancelling`; (2) applies the **failure budget** (more failed targets than `maxFailures` aborts the run, with `abortInFlight` asking in-flight targets to cancel); (3) dispatches a sliding window of `concurrency` targets, or waves of `batchSize` (the next wave starts only when the current one settled); (4) with `pauseAfterFirstBatch` pauses after wave 0 and creates a run-scope `gate` approval; (5) finishes as `succeeded`, `failed` (none succeeded) or `partially_failed`. A target parked `waiting` keeps its concurrency slot.

### 3.2 One segment

`runbook.target.run` (1) re-checks the run is not cancelling and that the initiator still holds `runbooks:run` and may use the server (else `PERMISSION_REVOKED`); (2) decrypts the server profile (`getDecryptedProfile(id, principal, 'run')`) and the run's secrets, and opens the connection through `SshConnectionFactory` (host key first: `HOST_KEY_UNKNOWN`, `HOST_KEY_MISMATCH`, `SSH_UNREACHABLE`, `SSH_AUTH_FAILED`); (3) runs each step: `when` decides run or skip, then by kind; (4) stores status, exit code, duration, a 4 KiB output tail; (5) settles the target and calls `advance` in the same transaction. A cancel is polled every 2 seconds.

`SshExecutor` sends **exactly** `bash -s` (`sh -s`, `python3 -`; `sudo -n [-u user] bash -s` with `runAs`) and puts everything else on **stdin**: a prelude (strict mode, `export NAME=<quoted>` for parameters and secrets, `cd -- <workdir>`), then the body, then EOF. No command, parameter or secret appears in the target's process list. Timeout and cancel send `INT`, then `KILL` after 10 seconds, then close the channel. `sudo -n` never prompts (`SUDO_PASSWORD_REQUIRED`).

### 3.3 Failure codes

Stored on target and step rows, shown in the UI, never renamed: `PERMISSION_REVOKED`, `HOST_KEY_UNKNOWN`, `HOST_KEY_MISMATCH`, `SSH_UNREACHABLE`, `SSH_AUTH_FAILED`, `PACKAGE_MANAGER_UNKNOWN`, `UNSUPPORTED_OPTION`, `DEST_EXISTS`, `STEP_KIND_NOT_AVAILABLE`, `DRY_RUN_PRECONDITION`, `EXECUTOR_LOST`, `APPROVAL_REJECTED`, `APPROVAL_EXPIRED`, `SUDO_PASSWORD_REQUIRED`, `STEP_FAILED`, `STEP_TIMED_OUT`, `CANCELLED`, `SECRET_UNAVAILABLE`, `FILE_TOO_LARGE`, `ARTIFACT_TOO_LARGE`, `UPLOAD_CHECKSUM_MISMATCH`, `FORBIDDEN`, `INTERNAL`; the AI step adds the codes of [§7](#7-ai-step-and-drafting).

### 3.4 Cancel, retry, resume

`POST /api/runbook-runs/:id/cancel` moves the run to `cancelling`; `.../targets/:targetId/cancel` cancels one. `POST .../retry` starts a new run (`retry_of_run_id`) over the failed targets. `POST .../resume` releases a run paused at a canary gate (needs `runbooks:run` **and** `runbooks:approve`). A run still `queued` that is cancelled never ran.

### 3.5 The reconcile sweep

`runbook.logs.compact` (system job, access reason `runbooks-reconcile`, every change inside the owning organization's scope) fails a target whose job vanished (`EXECUTOR_LOST`), advances a stuck run, expires approvals past `expires_at`, moves orphan log chunks older than an hour to storage, and fails an `ai_task` step whose agent job died. A job that dies mid-step is never retried: a retry would repeat commands that already ran.

## 4. Extending it

- **A new step kind.** Add a variant to `runbookStepSchema` and `RUNBOOK_STEP_KINDS`; implement execution in `target-run.handler.ts` (through `SshExecutor`, parameters on stdin) and its probe in `dry-run.ts` (read-only, on the probe allowlist); add its risk rule to `RunbookRiskService`; add a column to the step-kind table above; extend the builder UI. A schema change that is additive keeps `schemaVersion: 1`; a breaking one is a new version with a reader for the old.
- **A new failure code.** Add to `FAILURE_CODES` and the web's label map; codes are permanent.
- **A new approval kind.** The CHECK constraint on `runbook_approvals.kind` is a migration (`database-dev`), plus the handler branch in `runbook-approvals.service.ts` and a notification if people must be told.
- **A new run or target status.** A migration for the CHECK constraint **and** an entry in `state-machine.ts`.
- **A new system setting.** `runbooks.system-settings.ts` (organization layer tighten-only), the generated defaults catalog (`npm run catalog:settings`).
- **A new job type.** [add-job-type skill](../../.claude/skills/add-job-type/SKILL.md); SSH jobs stay server-only; add the type to `job-type-snapshot.spec.ts`.
- **A new notification or webhook.** `notifications-registry/runbooks.notifications.ts` (after-commit, in `RunLifecycleService`); webhook events in `runbooks/webhooks/runbooks.webhooks.ts` (permanent keys, strict metadata-only schema).

## 5. Logs and artifacts

### 5.1 The log sink

One `LogSink` per executed step is the **only** path from output to the database, the event bus, a browser and storage, so redaction lives there: decode UTF-8 per stream; buffer by line (a secret never straddles a chunk; a multi-line secret holds back `longest literal - 1` characters); **redact** with the shared patterns plus every secret value of the run as an exact literal (`[REDACTED:literal]`); split into chunks of at most 4 KiB; insert into `runbook_run_log_chunks` with a gap-free `seq` and publish on the `runbooks.run` bus channel; cap at `runbooks.maxLogBytesPerStep` (one `[output truncated]` system chunk, `log_truncated`). When the step ends the chunks are joined, uploaded to `runbook-artifacts/<orgId>/<runId>/<targetId>/<stepIndex>.log`, the key is recorded and the chunks deleted; a storage fault leaves the chunks for the sweep.

### 5.2 Streaming and reading

`GET /api/runbook-runs/:id/logs/stream` (and `.../targets/:targetId/logs/stream`) is SSE: `snapshot`, then with `Last-Event-ID: <stepRowId>:<seq>` a replay of chunks after that one, then live `chunk`, `step`, `target`, `run`, `approval` events and a 15-second `heartbeat`. The bus subscription opens before the snapshot is read, so nothing falls between. `GET .../targets/:targetId/steps/:stepIndex/log` reads one step's log (tail supported), from storage once archived. The CLI follows with `shellkeep runbook logs --follow`.

### 5.3 Collected logs and bundles

A `collect_logs` step runs one constant remote script (paths, units, caps and the window travel as environment variables, never in the script text), streams a tar.gz to a temp file, **fails `ARTIFACT_TOO_LARGE` the moment it passes `maxTotalBytes`** (also guarding against a gzip bomb), re-writes the archive with `redactText` on every file, and stores the redacted archive as a `target_archive` artifact with its sha256 and file count. A run's **bundle** (`POST /api/runbook-runs/:id/artifacts/bundle`, job `runbook.artifacts.bundle`, one per run) is a zip of step logs and archives plus a `manifest.json` of sha256 and sizes, built by streaming; entry names are sanitised. Downloads are **signed URLs valid 15 minutes** (audited `runbook_artifact.downloaded`); a run's initiator may share the bundle by **link** (resource type `runbook_run`, links only, 7 days default, 30 at most) through the public route `GET /api/public/runbook-runs/bundle`. Retention: `retention.runbookArtifacts` (default 30 days) deletes logs, archives and bundles; the run rows stay.

## 6. Safety

1. **Risk assessment.** `assessDefinition` (pure) classifies each line of `command` and `script` with `classifyCommand`; a step is destructive when any line is. `package_update` of `all`, `file_upload` into `/etc`, `/boot`, `/usr`, and an autonomous AI step are medium; an overwriting upload is high. A finding names step and reasons, never the command. The same answer feeds the builder, `POST /api/runbooks/validate`, GET responses and the launcher.
2. **Typed confirmation.** Starting a run whose definition is destructive (and which is not a dry run) needs `confirm: { runbookName, targetCount }` matching the exact name and the number of servers the selector resolves to now: otherwise `428 RUNBOOK_CONFIRMATION_REQUIRED` with the findings in `details`.
3. **Two-person rule.** Unless `runbooks.approvals.allowSelfApproval` is on, a destructive run is created `queued` behind a `destructive_run` approval (step index -2) and no start job exists until a **different** holder of `runbooks:approve` approves; rejection or expiry cancels the run (`APPROVAL_REJECTED`, `APPROVAL_EXPIRED`) and nothing ran. The initiator deciding gets 403 `RUNBOOK_SELF_APPROVAL`.
4. **Gates and canary.** `approval_gate` steps and `pauseAfterFirstBatch` (a `gate` approval at step -1). Approvals expire after `runbooks.approvals.defaultExpirySec` (24 h default); an expired canary aborts the run.
5. **Dry run.** `dryRun: true` connects to every target (host key and credential verified, facts refreshed) and sends one read-only probe per step from a fixed allowlist (`bash -n`, `command -v`, `apt-get -s`, `dnf --assumeno`, `apk --simulate`, `zypper --dry-run`, `test -w`, `ls -la`); every probe starts with a marker and the real-shell spec asserts the allowlist against what the SSH fixture received. `ai_task` and `approval_gate` are skipped, so a dry run creates no approvals; its probes are recorded as `origin: dry_run` command executions, and it ends with a `runbooks.dry_run_finished` in-app notification.
6. **Secrets.** A `secret` parameter is filled by naming an organization secret (`PUT /api/runbook-secrets/:name`, write-only; listing returns names). The value is decrypted at segment start, lives only in memory, travels on stdin, and is redacted from every log, preview and AI prompt.
7. **Audit.** Every command run or refused (steps, dry-run probes, AI agent) is a `runbook_command_executions` row: sha256, redacted 2 KiB preview, exit, signal, timed out, bytes, origin (`step`, `ai_agent`, `dry_run`), AI outcome and approver. `GET /api/runbook-runs/:id/audit`, `.../audit/export` (CSV) and `GET /api/runbook-commands` (per-server history) read it; run lifecycle events are audit events (`runbook_run.created`, `.cancelled`, `.target_cancelled`, `.destructive_confirmed`, `.ai_stopped`).
8. **Bounds.** `runbooks.enabled` is a kill switch (`503 RUNBOOKS_DISABLED`); `maxTargetsPerRun` (default 200), `maxConcurrency` (default 20), `defaultStepTimeoutSec` (600), `maxLogBytesPerStep` (5 MiB). The organization layer can only tighten.

## 7. AI step and drafting

### 7.1 The `ai_task` step

A pause point. `runbook.target.run` parks the target `waiting` with the step `running` and enqueues `ai.runbook.agent` (`phase: start`); an approval decision enqueues it again (`phase: resume`); when the step ends the job queues the next segment. **Pre-checks, each ending the step with its own code before any provider call or connection:** AI off (`AI_DISABLED`), `runbooks.ai.agentEnabled` off (`RUNBOOK_AI_DISABLED`), the server's `aiOutputSharing` off (`AI_OUTPUT_SHARING_DISABLED`: an agent cannot work blind), the initiator no longer holding `runbooks:run` and `ai:use` (`PERMISSION_REVOKED`).

**Policy** (`agent-policy.ts`, pure, judged before anything is asked of a person or sent): `deny` always wins; a destructive command is refused even when an `allow` pattern matches; a command or path naming a sensitive location (shadow files, SSH keys, `*.pem`, `*.key`) is refused; in `autonomous_within_allowlist` the command must match an `allow` pattern; `read_file` and `list_dir` are allowed except for sensitive paths. Patterns are RE2 and fail closed (an uncompilable `deny` matches everything, an uncompilable `allow` matches nothing). `per_command` needs an `approved` approval row of kind `ai_command` carrying the redacted command and its hash; `plan` approves a whole plan (`ai_plan`) up front; a stored command that differs from the one run is `AI_APPROVAL_MISMATCH`. Three refusals end the step (`AI_POLICY_VIOLATIONS`).

The agent's conversation is kept redacted on the step (`ai_transcript`, cleared when the step ends) so it can resume after an approval; the closing summary (`ai_summary`, at most 8,000 characters) is redacted. `POST /api/runbook-runs/:id/ai/stop` ("Stop AI", `runbooks:run`) ends agents before their next tool call (`AI_STOPPED`). Other codes: `AI_STEP_LIMIT` (the `maxSteps` rounds were used), `AI_FAILED`. A provider throttle with no command run defers the job; with a command already run it fails the step, because a retry would repeat it. The job spends the **initiator's own** AI key and is server-only.

### 7.2 Drafting

`POST /api/ai/runbooks/draft` (`ai:use`, feature `runbook_draft`) turns a description into a definition via one structured model call validated against the definition schema. It never saves and never runs: the answer is `{ definition, warnings, risk }`, loaded into the builder and saved through the normal route (which validates again). The model is told what the servers are (name, OS, package manager from stored facts) and nothing a server printed; instructions forbid inline secrets.

## 8. Notifications, webhooks and onboarding

In-app, email and push to the person who started a run: `runbooks.run_finished`, `runbooks.run_failed`; to the holders of `runbooks:approve`: `runbooks.approval_requested`; in-app only to the initiator: `runbooks.dry_run_finished`. Payloads name the runbook, version and counts and link into the app, never a command, output or host. They are sent after commit. Two **webhook events** are registered (`runbooks/webhooks/runbooks.webhooks.ts`; keys permanent; audience `org`, each endpoint receives them only while its owner holds `runbooks:read`; raised after commit; strict schemas, metadata only: ids, runbook name, status, counts, times and a link, never a command, output, parameter, secret or host): `runbook.run.completed` (`{ runId, runbookId, runbookName, version, status, trigger, scheduleId?, counts, startedAt, finishedAt, url }`, not raised for a dry run) and `runbook.approval.requested` (`{ approvalId, runId, kind, runbookName, expiresAt, url }`). A schedule the system switches off sends `runbooks.schedule_disabled` in the app. The Getting-started step `shellkeep.first-runbook` counts the caller's runbooks. Metrics: `app.runbooks.*` ([ARCHITECTURE §10](../ARCHITECTURE.md#10-observability)). Export: the caller's runbook definitions are exported; runs, approvals and logs are not.

## 9. Schedules

A schedule (`runbook_schedules`, an org table under forced RLS) runs one runbook on a 5-field cron expression in an IANA time zone, with parameters, secret references, a target selector, an optional strategy override, a `versionPin` (`latest` or one version) and an `overlap` policy (`skip`, `queue`, `allow`). It runs **as the person it runs as** (`run_as_user_id`: its creator, or whoever last changed its targets, parameters, secrets, strategy or pin); that person's permissions are re-checked on every fire. Runs it creates have `trigger = 'schedule'` and `schedule_id`; a run nobody started has no owner for link sharing.

| Route | Permission |
|---|---|
| `GET /api/runbooks/:id/schedules`, `.../:scheduleId` | `runbooks:read` |
| `POST`, `PATCH`, `DELETE /api/runbooks/:id/schedules[/:scheduleId]` | `runbooks:write` and `runbooks:run` |
| `POST .../:scheduleId/approve` | `runbooks:approve` |
| `POST .../:scheduleId/run-now` | `runbooks:run` (runs as the caller, does not move `next_run_at`) |
| `GET /api/runbook-schedules/preview?cron=&timezone=` | `runbooks:read` (the next five fire times) |

**Firing.** An enqueue-only `@Cron` (every minute) queues the system job `runbook.schedules.tick`. The handler finds due schedules across organizations through the bypass client under the registered access reason `runbooks-schedules`, and changes nothing there: each schedule is handled inside its own organization. In order: (1) **claim** the slot by a guarded update of `next_run_at` to the first slot strictly after now (two racing ticks create one run; a missed slot is **not** caught up); (2) **check** as the run-as user (active, holds `runbooks:run` and `servers:read`, may run the runbook; runbook not archived; pinned version exists; a destructive version is approved for that version); (3) apply **overlap** (`skip` creates nothing while the previous run is active); (4) create the run exactly as a manual launch does (`RunbookRunsService.create`, which enqueues `runbook.run.start` in the same transaction). A claimed slot whose run cannot be created is lost, never repeated. A schedule fires within a minute of its time.

**Switched off by the system** (`enabled = false`, `next_run_at = null`, `disabled_reason`, and an in-app `runbooks.schedule_disabled` notification to the run-as user): `PERMISSION_REVOKED`, `APPROVAL_REQUIRED`, `RUNBOOK_ARCHIVED`, `VERSION_MISSING`, `RUN_REJECTED`.

**Destructive runbooks.** A scheduled run has no per-run confirmation and no per-run approval, so both happen once, to the schedule: creating or materially changing one (targets, parameters, secrets, strategy, pin) for a destructive version needs `confirm { runbookName, targetCount }` (`428`), and then a **different** person holding `runbooks:approve` approves it (`403 RUNBOOK_SCHEDULE_SELF_APPROVAL` for the run-as user unless `runbooks.approvals.allowSelfApproval`). Until then it is disabled with `APPROVAL_REQUIRED`. The approval covers **one version** (`approved_version`): a new destructive version under `latest` switches the schedule off at its next slot until re-approved.

Errors: `422 RUNBOOK_SCHEDULE_INVALID` (`details.field`: `cron`, `timezone`, `versionPin`), `409 RUNBOOK_SCHEDULE_APPROVAL_REQUIRED`, `409 RUNBOOK_SCHEDULE_OVERLAP`. Audit events: `runbook_schedule.created`, `.updated`, `.deleted`, `.approved`, `.run_now`. Metric: `app.runbooks.schedule_fires` (`outcome`: `fired`, `skipped_overlap`, `disabled`, `failed`). Deleting a schedule keeps its past runs (their `schedule_id` is cleared). Rollback: disable the schedules first.

## 10. Invariants

1. A runbook version is immutable; history survives a profile edit (targets are snapshots).
2. No secret value is stored in a definition, a run row, a job payload, an event or a log; output is redacted at the sink with the run's literals; parameters and secrets reach a target only on stdin.
3. SSH jobs (`runbook.target.run`, `ai.runbook.agent`) are server-only with `maxAttempts: 1`; a dead job is failed by the sweep, never re-run.
4. Every connection verifies the host key before sending a credential; the initiator's permission and access to each server are re-checked at run start and at every segment.
5. `advance` is the only place a run moves, inside one organization transaction, with the enqueue in the same transaction; notifications and events leave after commit and never throw.
6. A destructive run (not a dry run) cannot start without the typed confirmation, and, under the default setting, a second person's approval; a destructive schedule needs both once, per version, before it fires.
7. A dry run changes nothing on a server: probes come from the allowlist.
8. The AI policy is evaluated before any approval is requested or command sent; deny and destructive refusals cannot be overridden by an allow pattern or by the model.
9. Run tables and `runbook_schedules` are `org` tables under forced RLS with composite keys including `org_id`; the sweep, the purge and the schedule tick are the only cross-organization readers, under registered access reasons.
9a. A schedule fires at most once per slot and never catches up a missed one; its run-as user's permissions are re-checked at every fire.
10. Job type strings, step kinds, failure codes, approval kinds and the `runbook`/`runbook_run` resource ids are permanent.

## 11. Tests

`apps/api/test/runbooks/` (`runbook-engine.db`, `runbook-safety.db`, `runbook-ai.db`, `runbook-schedules.db`, `runbook-artifacts.db`, `runbooks-rls.db`, `runbooks.db`, RBAC and draft integration, `version-immutability`; `runbook-ssh-fixture.ts` is an in-process SSH server), unit specs beside the code (`run-plan`, `state-machine`, `dry-run`, `ssh-executor`, `log-sink`, `agent-policy`, `runbook-risk`, `tar-redact`, the schema), the job-handler conformance specs, and `apps/api/test/docs-consistency.spec.ts` for the step-kind and run-status lists above ([TESTING.md](../TESTING.md)).
