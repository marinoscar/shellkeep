# API Conventions

This page states the rules every ShellKeep route follows. It does not list endpoints: the per-endpoint reference (paths, parameters, schemas, required permissions) is the generated OpenAPI document served at `/api/docs`, built from the running code, which cannot drift from it. Most conventions are the platform host's; the generic text is in the [EnterpriseAppBase API conventions](https://github.com/marinoscar/EnterpriseAppBase/blob/main/docs/API.md) and this page records only what applies here and what ShellKeep adds (the terminal WebSocket, runbook and AI streams, its error codes).

## Base URL

| Environment | URL |
|---|---|
| Local Docker | `http://localhost:8323/api` (Nginx, `NGINX_PORT`) |
| Deployment | `https://app.example.test/api` |

The web app is at `/`, the API under the global prefix `/api`, the reference at `/api/docs` (Scalar) and the document at `GET /api/openapi.json`. One origin: the API enables no CORS policy.

`npm run openapi:dump` (repository root) writes `openapi.json` without a database; `npm run openapi:lint` runs Spectral with `.spectral.yaml`. A new route needs `@ApiOperation`, `@ApiResponse` and `@Auth()`; the permission line of the document is generated from `@Auth()`, and every tag must be declared in `apps/api/src/app-registrations/openapi-tags.ts` (an undeclared tag fails a test).

## Authentication

Declared per route: `@Auth({ permissions })` applies the JWT and permission guards, `@Public()` marks a route that needs no credential. There is no global guard.

| Credential | Sent as | Accepted on |
|---|---|---|
| Access token (JWT, 15 minutes) | `Authorization: Bearer <jwt>` | every authenticated route |
| Refresh token | HttpOnly `refresh_token` cookie | `POST /api/auth/refresh`, `/auth/switch-org`, `/auth/logout` |
| Personal access token | `Authorization: Bearer pat_...` | every authenticated route; the CLI's token |
| Link-share token | `X-Link-Token: lnk_...` | `GET /api/public/links/current` and the run-bundle route |
| WebSocket token | first `auth` message, never a URL | `WS /api/terminal/ws` |

Tokens in a query string are not accepted. The `/api/docs` page pre-authorizes with the refresh cookie. Permissions are org-scoped: a request acts in the caller's active organization. Sign-in and token routes are the platform identity slice's; see [SECURITY-ARCHITECTURE.md](SECURITY-ARCHITECTURE.md#2-sign-in-and-tokens).

## Response envelope

A global interceptor wraps every successful JSON body:

```json
{ "data": { "id": "..." }, "meta": { "timestamp": "2026-11-24T12:00:00.000Z" } }
```

Not enveloped: SSE streams, `204`, file downloads (`GET /api/sessions/:id/history` is `text/plain`), and the RFC 8628 device-token body.

## Errors

One global filter builds every error body:

```json
{ "statusCode": 409, "code": "AI_CONSENT_REQUIRED", "message": "...", "details": {}, "timestamp": "...", "path": "/api/ai/terminal/assist" }
```

- `code` is an open string: derived from the status (`BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `UNPROCESSABLE_ENTITY`, `TOO_MANY_REQUESTS`, `INTERNAL_ERROR`, `ERROR`) or a registered domain code. Branch on `code` or `details.reason`, never on `message`; tolerate codes you do not know.
- A body or query that fails validation is `400` with `details.issues` (`{ path, message }` per field, never the submitted value).
- **A record you may not see is `404`, never `403`.** This holds for servers, sessions, runbooks, runs and summaries.
- Maintenance: `503`, `Retry-After: 30`, `details.reason: "MAINTENANCE_MODE"`.

ShellKeep's domain codes (registered with `registerErrorCode`):

| Area | Codes |
|---|---|
| SSH and host keys | `HOST_KEY_UNKNOWN`, `HOST_KEY_MISMATCH` (409), `HOST_KEY_CHANGED_DURING_TRUST`, `HOST_KEY_CONFIRMATION_REQUIRED`, `SSH_HOST_UNREACHABLE`, `SERVER_PROFILE_CREDENTIAL_HOLDER_ONLY` |
| Terminal AI | `AI_CONSENT_REQUIRED`, `AI_OUTPUT_SHARING_DISABLED` (409), `AI_ASSIST_UNPARSEABLE`, `AI_EXPLAIN_EMPTY` (in-band stream errors), `SESSION_TERMINATED` |
| Runbook definitions | `RUNBOOK_DEFINITION_INVALID`, `RUNBOOK_NAME_TAKEN`, `RUNBOOK_ARCHIVED`, `RUNBOOK_HAS_ACTIVE_RUNS`, `RUNBOOK_IF_MATCH_REQUIRED`, `RUNBOOK_TARGET_GROUPS_UNAVAILABLE` |
| Runbook runs | `RUNBOOKS_DISABLED` (503), `RUNBOOK_PARAMS_INVALID`, `RUNBOOK_SECRET_REF_UNKNOWN`, `RUNBOOK_NO_TARGETS`, `RUNBOOK_SELF_APPROVAL`, `RUNBOOK_APPROVAL_NOT_PENDING`, `RUNBOOK_RUN_STATE`, `RUNBOOK_CONFIRMATION_REQUIRED` (428) |

The authoritative list is `/api/docs` (`ErrorDto.code` examples) and the registrations under `apps/api/src/{ssh,terminal-ai,runbooks}/`.

## Pagination

Offset pagination, `page` (default 1) and `pageSize` (default 20, max 100); the flat shape `{ items, total, page, pageSize, totalPages }`. `GET /api/sessions` also takes `status` (`active`, `detached`, `terminated`, `all`) and `serverProfileId`; `GET /api/server-profiles` takes tag and search filters. Each operation's schema in `/api/docs` is the contract.

## Optimistic concurrency (`If-Match`)

Settings-style resources return an integer `version`; send it in `If-Match` to make a write conditional (`409 CONFLICT` on mismatch). Runbook definitions are immutable versions: `PUT /api/runbooks/:id/definition` saves a new version and requires `If-Match: "v<n>"` naming the version you are replacing (`400 RUNBOOK_IF_MATCH_REQUIRED` when absent, `412` when a newer version exists); the response carries the new `ETag`.

## Server-Sent Events

`text/event-stream` routes. The browser `EventSource` cannot send `Authorization`, so clients use a fetch-based reader; Nginx serves each from an unbuffered location (`infra/nginx/app.d/locations/`).

| Route | Frames | Keep-alive |
|---|---|---|
| `POST /api/ai/terminal/assist` | `context`, `delta`, then one `result { command, explanation, risk, destructive, reasons }` or `error { code }` | stream ends |
| `POST /api/ai/terminal/explain` | `context`, `delta`, then `result { markdown }` or `error { code }` | stream ends |
| `GET /api/runbook-runs/:id/logs/stream` (and `.../targets/:targetId/logs/stream`) | `snapshot`, then `chunk` (SSE id `<stepRowId>:<seq>`, honours `Last-Event-ID`), `step`, `target`, `run`, `approval` | `heartbeat` every 15 s |
| `GET /api/notifications/stream` | `notification` | platform |

A refusal **before** the first frame (consent, switch, ownership) is an ordinary JSON error; a failure after it is an in-band `error` frame. Closing the connection cancels the model call.

## The terminal WebSocket

`WS /api/terminal/ws` is not an HTTP route and is not in the OpenAPI document. Summary (the full table is [specs/terminal.md §3](specs/terminal.md#3-websocket-protocol)):

| Direction | Message |
|---|---|
| client to server | `{type:"auth", token}`, `{type:"connect", sessionId}`, `{type:"resize", cols, rows}`, `{type:"ping"}`, binary frames = terminal input |
| server to client | `auth_ok`, `auth_refreshed`, `auth_fail {reason}`, `auth_expired`, `session_ready {sessionId}`, `session_error {error, code}`, `session_ended {reason}`, `pong`, binary frames = terminal output |

Authenticate within 5 seconds; re-send `auth` after every token refresh. The WebSocket is exempt from the envelope.

## Rate limits

There is no global HTTP limiter. Targeted limits belong to the platform: AI (per user, org key and model, `429` with `details.reason: "AI_RATE_LIMITED"`), device-token polling (`slow_down`), member lookup and public link resolution. A run's fan-out is bounded by the `runbooks` system settings (`maxTargetsPerRun`, `maxConcurrency`).

## Route groups

All under `/api`. Exact routes: `/api/docs`.

| Prefix | What | Permission | Design doc |
|---|---|---|---|
| `server-profiles` | profiles, tags, connection test, host-key scan, trust and forget, facts refresh | `servers:read/write/delete` | [ARCHITECTURE §3.1](ARCHITECTURE.md#31-server-profiles) |
| `sessions` | list, create, rename, terminate, batch-terminate, history download | `sessions:read/write/delete` | [specs/terminal.md](specs/terminal.md) |
| `dashboard` | Home summary | `sessions:read` | [ARCHITECTURE §3.7](ARCHITECTURE.md#37-dashboard-cli-and-android) |
| `ai/terminal` | assist, explain (+ `explain/preview`), consent, session summaries (`sessions/:id/summaries`) | `ai:use` | [specs/terminal-ai.md](specs/terminal-ai.md) |
| `ai/runbooks` | draft a runbook with AI | `ai:use` | [specs/fleet-runbooks.md §7](specs/fleet-runbooks.md#7-ai-step-and-drafting) |
| `runbooks` | definitions, versions, validate, targets preview, archive and restore | `runbooks:read/write` | [specs/fleet-runbooks.md](specs/fleet-runbooks.md) |
| `runbook-secrets` | write-only organization secrets | `runbooks:write` | same |
| `runbooks/:id/runs`, `runbook-runs` | start, list, status, logs, SSE, cancel, retry, resume, audit, `ai/stop`, artifacts | `runbooks:run/read` | same |
| `runbook-approvals` | list, decide | `runbooks:read/approve` | same |
| `public/runbook-runs` | a run's log bundle by link | public (link token) | same |
| `auth`, `pat`, `users`, `allowlist`, `groups`, `grants`, `public/links` | identity and sharing | platform | [EAB API.md](https://github.com/marinoscar/EnterpriseAppBase/blob/main/docs/API.md#route-groups) |
| `user-settings`, `system-settings`, `org-settings`, `storage/objects`, `notifications`, `webhooks`, `ai`, `admin/*`, `nodes`, `health` | platform slices | per slice | the slice READMEs ([ARCHITECTURE §2](ARCHITECTURE.md#2-subsystem-map)) |

`GET /api/health/live` and `GET /api/health/ready` (database) are public.
