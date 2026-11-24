# Security Architecture

> **Audience:** developers and reviewers · Platform-owned mechanisms (sessions, token storage, credential encryption, tenant isolation) are documented in the [EnterpriseAppBase security architecture](https://github.com/marinoscar/EnterpriseAppBase/blob/main/docs/SECURITY-ARCHITECTURE.md); this page covers how ShellKeep uses them and what it adds. Examples use `server-a.example.test` and obviously fake fingerprints (`SHA256:AAAA...`); a real host, key or token never belongs in this repository.

ShellKeep holds the keys to other people's servers. The design goal is that an SSH secret exists in plaintext in exactly one place, the API process, for the length of one SSH call; that a terminal's content reaches a model only when the owner has allowed it and only after redaction; and that a fleet-wide command needs a typed confirmation and, when destructive, a second person.

## Contents

1. [Trust boundaries](#1-trust-boundaries)
2. [Sign-in and tokens](#2-sign-in-and-tokens)
3. [Terminal WebSocket authorization](#3-terminal-websocket-authorization)
4. [SSH secrets and host keys](#4-ssh-secrets-and-host-keys)
5. [Authorization](#5-authorization)
6. [Terminal content and AI](#6-terminal-content-and-ai)
7. [Runbook safety](#7-runbook-safety)
8. [Database role and row-level security](#8-database-role-and-row-level-security)
9. [Secrets inventory](#9-secrets-inventory)
10. [Egress](#10-egress)
11. [HTTP hardening, validation and uploads](#11-http-hardening-validation-and-uploads)
12. [Audit and logging](#12-audit-and-logging)
13. [Threat model](#13-threat-model)
14. [Security checklist](#14-security-checklist)

## 1. Trust boundaries

```
 browser ──HTTPS──> host proxy ──> nginx ──> API ──SSH──> target servers (untrusted output)
                                              │  └────HTTPS──> AI providers (redacted text only)
                                              └────SQL────> PostgreSQL (ciphertext for secrets)
 worker node ──nod_ token──> API   (receives no SSH secret, no AI key, no terminal text; see §4)
```

| Data | Class | Where it may exist |
|---|---|---|
| SSH password, key, passphrase | secret | credential store (ciphertext); API memory during one SSH call |
| Runbook secret parameters | secret | organization credential store; API memory during one segment |
| AI provider keys | secret | credential store, per user; API memory during one provider call |
| Terminal input and output | sensitive | browser, API relay memory, target server tmux. Never stored by ShellKeep |
| Redacted terminal text for AI | sensitive | API memory and the provider call; summaries store only the model's redacted answer |
| Runbook step output | sensitive | redacted at the sink, then hot buffer and object storage under `runbook-artifacts/` |
| Host-key fingerprint | public | database, API responses |
| Session and profile metadata | internal | database, exports |

Target-server output is untrusted input: it is stripped of control sequences and redacted before any model sees it, and a model's answer is never executed without a person (§6, §7).

## 2. Sign-in and tokens

Sign-in, sessions and tokens are the platform identity slice ([README](https://github.com/marinoscar/EnterpriseAppBase/blob/main/packages/platform-api/src/identity/README.md)); ShellKeep binds it in `apps/api/src/platform/identity/` with Google as the only provider and the OAuth server not mounted.

- **Access token**: JWT, 15 minutes, read only from `Authorization: Bearer`, held in browser memory. **Refresh token**: opaque, HttpOnly `refresh_token` cookie, rotated on every use, stored hashed.
- **Email allowlist**: only pre-authorized addresses may sign in; `INITIAL_ADMIN_EMAIL` always may. A deactivated user's token fails at the next principal check.
- **Personal access tokens** (`pat_`) and the **device flow** ([RFC 8628 guide](https://github.com/marinoscar/EnterpriseAppBase/blob/main/docs/DEVICE-AUTH.md)) serve the CLI and headless agents. A PAT is accepted on the terminal WebSocket too (§3). A worker-node token (`nod_`) and an OAuth token are not.
- **Test login** (`/api/auth/test/*`) exists only outside production.

## 3. Terminal WebSocket authorization

A WebSocket frame has no `Authorization` header and the platform guard only runs on HTTP, so the gateway (`apps/api/src/terminal/terminal.gateway.ts`) enforces the same rules itself. The mechanism is recorded as a shim: `PLATFORM-ADOPTION-SHIM(#47)` on `TerminalPrincipalResolver`, pending a platform seam "verify an access token for a non-HTTP transport" ([local-exceptions.md](platform-adoption/local-exceptions.md)).

1. **In-band token.** The first message must be `{type:"auth", token}` within **5 seconds** or the socket closes (`Authentication timeout`). The token is never read from a URL and never logged.
2. **Resolution.** `TerminalPrincipalResolver` verifies the JWT signature and expiry with the slice's secret, then runs the slice's own `AuthService.validateJwtPayload` (principal cache, device-session and active-organization checks) and `toPrincipal`. A revoked device or removed member fails here as on HTTP. A `pat_` token goes through `PatService.resolveToken`.
3. **Permission.** The principal must hold `sessions:write` or the answer is `auth_fail` with reason `forbidden`; a Viewer can list sessions but never type into one.
4. **Expiry.** The socket ends with `auth_expired` when the access token's `exp` passes (a PAT socket after 15 minutes). The client re-sends `auth` before then; a re-auth as a different user or organization is refused (`identity_changed`, reason `forbidden`). Every message re-checks that the socket is still live.
5. **Maintenance.** While a window is open, a **new** `auth` and a **new** `connect` are refused with reason `maintenance` (admins exempt when `allowAdmins`); an open socket and a token refresh are never cut. An unreadable window fails open, so a settings fault is not an outage.
6. **Session ownership.** `connect` takes a UUID the client supplies, never trusted: it must be a session owned by this user in this organization, else `NOT_FOUND` (also for another user's session, so existence is not disclosed). The right to connect to the **server** is re-checked on every attach through the sharing policy, so a revoked share closes the door for a running session too (the stream already open keeps streaming until it closes; see invariant 8 of [terminal.md](specs/terminal.md#7-invariants)).
7. **Input is raw.** Binary frames are written to the SSH stream only while the socket is live and attached.

Denials are counted by bounded reason (`invalid_token`, `forbidden`, `expired`, `maintenance`, `timeout`) in `app.terminal.ws.auth_denied`; the alert rule `shellkeep.ws_auth_denied_spike` watches it. Protocol: [specs/terminal.md §3](specs/terminal.md#3-websocket-protocol).

## 4. SSH secrets and host keys

### 4.1 Secrets

- **Store.** A server profile's password, private key and passphrase are three user credentials, purpose `ssh`, named `profile.<profileId>.<field>`, in the platform credential store. The AES-256-GCM key for a user's secret is derived per user and per purpose (the purpose is the sub-key domain, so renaming a purpose would orphan its secrets; `ssh` is permanent). The master key is `SECRETS_ENCRYPTION_KEY`.
- **No fallback, ever.** The purpose is registered with `system: null` and `fallback: []`: the resolver never answers an SSH secret from an organization or deployment credential, and a profile's secret is its owner's alone. Org-owned or group-shared servers use the organization tier with the same names.
- **Credentials never move.** A share grants a role, not a secret. Only the user who saved the secrets (`server_profiles.user_id`) may change the connection (host, port, user) or the secrets (`SERVER_PROFILE_CREDENTIAL_HOLDER_ONLY`); a different editor cannot redirect a connection to harvest a credential.
- **Write-only.** No API response, export, log line, span, metric label, job payload, notification or webhook payload carries a secret or its ciphertext. The profile list shows no "has password" flag. Exports allowlist their columns and omit the three legacy `encrypted_*` columns.
- **Decryption** happens in `ServerProfilesService.getDecryptedProfile(id, principal, purpose)` (purposes `connect`, `test`, `run`, `exec`), which first re-checks the sharing policy, and the plaintext lives only inside the SSH call.
- **Never to nodes, never to AI.** SSH jobs (`runbook.target.run`, `ai.runbook.agent`) are server-only: they carry neither `nodeResultSchema` nor `persistNodeResult`; no node ever receives an SSH secret. Prompts, tool results and summaries are redacted with the run's secret values as literals.
- **Legacy ciphertext.** Until [#84](https://github.com/marinoscar/shellkeep/issues/84) drops them, the old columns hold ciphertext under the retired key, unread. Doctor's legacy-secrets check reports profiles not yet migrated ([runbooks/ssh-secret-reencryption.md](runbooks/ssh-secret-reencryption.md)).

### 4.2 Host-key verification (trust on first use)

Every connection path (terminal, test, host-key scan, facts probe, runbook segment, AI step, Doctor probe) opens through `SshConnectionFactory.open`, which checks the presented key **before any credential is sent**. The table is `apps/api/src/ssh/host-key-policy.ts`:

| Situation | interactive, test, exec | scan |
|---|---|---|
| fingerprint equals the pinned one | accept | capture |
| none pinned, `tofu_prompt` (default) | refuse `HOST_KEY_UNKNOWN` | capture |
| none pinned, `tofu_auto` | trust and accept, audited | capture |
| none pinned, `strict` | refuse `HOST_KEY_UNKNOWN` | capture |
| differs | **always** refuse `HOST_KEY_MISMATCH` | capture |

A changed key is never accepted by any policy or purpose. The user scans, compares the fingerprint out of band and trusts it (`POST /server-profiles/:id/host-key/trust`, which fails `HOST_KEY_CHANGED_DURING_TRUST` if the key moved in between, and needs the fingerprint to be confirmed); replacing or forgetting a key is a separate audited write needing `servers:write`. The policy is the `ssh.hostKeyPolicy` system setting. A runbook run snapshots each target's trusted fingerprint. The gateway returns the presented and expected fingerprints in the `session_error` so the UI can warn of interception.

## 5. Authorization

- **RBAC.** `admin` is a system role and holds no domain permission; `org_admin`, `contributor` and `viewer` are org roles. The matrix is in [ARCHITECTURE.md §4](ARCHITECTURE.md#4-authorization) and is checked against the generated catalog. Every route declares `@Auth(...)` or `@Public()`; there is no global JWT guard, so a route without `@Auth()` is public. Permission checks are server-side only; the UI hides, the API decides.
- **Sharing.** Two resource types: `server_profile` (`viewer` < `operator` < `editor`) and `runbook` (`viewer` < `runner` < `editor`). The sharing slice's `AccessPolicy` is the one decision point: owner or owning-group role, then grants, then the action's minimum role, with the RBAC permission required **on top**, even of the owner (a Viewer member holding a share still cannot open a session). A denial answers **404**, never 403. Link sharing is off for both types (`POST /api/grants/links` answers 422 `ROLE_NOT_GRANTABLE`); the one linkable type is a run's log bundle (`runbook_run`), served by a public route with its own miss limit and `no-store`.
- **Runbooks need two grants.** `runbooks:run` plus `connect` on **each** target server, decided per target when the run starts and again when each segment starts (`PERMISSION_REVOKED` fails a target whose initiator lost either).
- **Ownership of sessions.** A session is the caller's own; each person who connects to a shared server opens their own tmux session. Session queries filter `user_id` and `org_id` via `OwnerScope`.
- **Tenant isolation.** See §8.

## 6. Terminal content and AI

Terminal output may contain secrets (a `cat` of an env file, a pasted token). Terminal AI therefore has one door, `TerminalContextService.forAi` ([specs/terminal-ai.md](specs/terminal-ai.md)); a capture can reach a model only through it, and `capture-pane` appears only in `SessionHistoryService` (guard spec `test/terminal-ai/capture-boundary.spec.ts`).

1. **Owner and organization** of the session are checked (404 otherwise).
2. **Consent.** Unless the organization turned `requireConsent` off, the user must have accepted the consent text (`terminalAi.consentAcceptedAt`, audited as `terminal_ai.consent`); else `409 AI_CONSENT_REQUIRED`. An organization can only tighten.
3. **Per-server switch.** `server_profiles.ai_output_sharing = false` is the **hard control**: no output of that server reaches any AI feature (`409 AI_OUTPUT_SHARING_DISABLED`). Command assist then receives metadata only (OS, shell, cwd), and the runbook AI step refuses to run on that server.
4. **Capture, strip, redact, cap.** ANSI and control sequences are stripped; `redactText` replaces secrets with `[REDACTED:<kind>]` (kinds: AWS keys, GitHub, Slack and Google tokens, LLM keys, JWTs, private-key blocks, URL credentials, auth headers, `key=value` secrets, platform tokens, exact literals, high-entropy strings). `strict` mode also drops every line that had a finding. Redaction is defence in depth, not a guarantee: the per-server switch is the control that holds. Text is capped (assist 40 lines, explain 200 lines and 16 KiB of selection, summary 200,000 characters), dropping the oldest.
5. **Audit without content.** One `terminal_ai.request` audit event records purpose, counts and sizes, never text. Metrics record redaction kind and count only.
6. **Output of the model.** A suggested command carries a risk class computed by `classifyCommand`, never by the model, and is only ever returned as text: nothing in the API or the web client runs it. A summary is redacted again and capped before it is stored.
7. **Keys are the user's own** (`AiService.forUser`); no deployment fallback; the provider SDK is imported only inside the platform AI providers package.

## 7. Runbook safety

Detail and flows: [specs/fleet-runbooks.md §6](specs/fleet-runbooks.md#6-safety).

- **Definitions never hold secrets.** A `secret` parameter has no default and no stored value; a run records the **name** of an organization credential (`secret_refs`, purpose `runbook_secret`, write-only). The value is read at segment start and lives only in that process's memory. Parameters and secrets reach the target on **stdin** (`bash -s`), never in argv, so no local user on the target can read them from the process list.
- **Risk assessment.** `assessDefinition` classifies every line of a `command` or `script` with `classifyCommand`; `file_upload` into `/etc`, `/boot`, `/usr` is medium, with `overwrite` high; `package_update` of `all` is medium; an autonomous AI step is medium. A definition with any destructive step is **destructive**. Findings name the step and reasons, never the command text.
- **Destructive launch.** A destructive run (not a dry run) must carry `confirm = { runbookName, targetCount }` matching the exact name and the number of servers the selector resolves to now, else `428 RUNBOOK_CONFIRMATION_REQUIRED`. Unless `runbooks.approvals.allowSelfApproval` is on, the run then parks behind a `destructive_run` approval that **a different person** holding `runbooks:approve` (only `org_admin`) must grant; the initiator's own decision answers `RUNBOOK_SELF_APPROVAL`. Audited as `runbook_run.destructive_confirmed`.
- **Approval gates and canary.** An `approval_gate` step parks a run or one target; `pauseAfterFirstBatch` pauses after the first wave. Approvals expire (`runbooks.approvals.defaultExpirySec`, default 24 h); an expired or rejected approval ends the run (`APPROVAL_EXPIRED`, `APPROVAL_REJECTED`).
- **Dry run.** Connects to every target (host key and credential verified as usual) and sends one read-only probe per step from a fixed allowlist (`bash -n`, `command -v`, package-manager simulation, `test -w`, `ls -la`); nothing that changes a server is sent. A dry run creates no approvals and skips AI and gate steps.
- **AI step.** Every `run_command` is judged by the policy before anything is asked of a person or sent: `deny` patterns always win; a destructive command is refused even if an `allow` pattern matches; sensitive paths (shadow files, SSH keys, `*.pem`, `*.key`) are refused; in `autonomous_within_allowlist` the command must match an `allow` pattern; patterns are RE2 (linear time) and fail closed. `per_command` and `plan` need an `approved` row whose stored command hash matches (`AI_APPROVAL_MISMATCH` otherwise). Three refusals abort the step; "Stop AI" ends agents before their next tool call. Everything the model sees is stripped and redacted with the run's literals.
- **Audit.** Every command a run or an AI agent executes or refuses is a `runbook_command_executions` row: sha256, a redacted 2 KiB preview, exit, outcome, approver. `GET /api/runbook-runs/:id/audit` and a CSV export read it; RBAC `runbooks:read`.
- **Log hygiene.** The log sink redacts every chunk with the exact secret values before it is buffered, streamed or archived; collected archives are re-written with redaction (`tar-redact`) and capped; logs expire by retention (`runbookArtifacts`, 30 days default).
- **Schedules.** A schedule has no per-run confirmation, so a destructive one is confirmed and approved by a second person **once, per version** before it fires; a new destructive version switches it off until re-approved. It runs as a named user whose permissions are re-checked at every fire (a revoked user disables it, never widens it); the tick reads across organizations only to find due rows, under the access reason `runbooks-schedules`, and acts inside each organization.
- **Webhooks and notifications of runs** carry ids, names, counts and a link only (`runbook.run.completed`, `runbook.approval.requested`); strict schemas.
- **No retries of side effects.** `runbook.target.run` and `ai.runbook.agent` have `maxAttempts: 1`.

## 8. Database role and row-level security

- The API connects as an ordinary `NOSUPERUSER NOBYPASSRLS` role that owns the tables (`shellkeep_app`, [runbooks/application-role.md](runbooks/application-role.md)); RLS is inert for a superuser. Doctor check `db.rls_role` verifies it.
- The runbook tables and the platform's `org` tables force RLS on `org_id`. `app.org_id`, `app.user_id`, `app.rls_bypass` are written only with `set_config(name, value, true)` as the first statement of a transaction (`forOrg`/`runInOrg`, `asSystem`), never a session `SET`. A job touching org tables carries `orgId` in its payload and runs under `JobScope.run`. Only files in the `ALLOWLIST` of `apps/api/test/tenancy/system-injection-boundary.spec.ts` may inject `PrismaSystemService`, each naming a registered reason; ShellKeep's reasons are the runbook reconcile, artifacts purge and schedules tick.
- **Standing constraint:** `server_profiles`, `terminal_sessions` and `terminal_session_summaries` carry `org_id` as a reference and are **not** under RLS. Isolation there is code: every query filters on `user_id` and `org_id`, the sharing policy decides cross-user access, and `ModelOwnership` and the `user-owned-data` conformance suite fail on an unclassified model. Enabling RLS on them is future work.
- Every dump and restore carries both `--enable-row-security` and `PGOPTIONS=-c app.rls_bypass=on`; a backup is streamed, never buffered ([runbooks/database-backup-restore.md](runbooks/database-backup-restore.md)).

## 9. Secrets inventory

| Secret | Where it lives | Rotation |
|---|---|---|
| `SECRETS_ENCRYPTION_KEY` | environment only; encrypts every credential-store row | platform runbook [rotate-secrets-encryption-key](https://github.com/marinoscar/EnterpriseAppBase/blob/main/docs/runbooks/rotate-secrets-encryption-key.md) (re-encrypts the three credential tables) |
| `JWT_SECRET` (min 32 chars) | environment only | restart invalidates sessions |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | environment | Google console |
| `POSTGRES_PASSWORD` (application role) | environment | role password change |
| SSH password, key, passphrase | credential store, user tier, purpose `ssh` | the owner edits the profile |
| Runbook secret parameters | credential store, organization tier, `runbook_secret` | write-only `PUT /api/runbook-secrets/:name` |
| AI provider keys | credential store, per user (and organization tier) | the user, in settings |
| SMTP, SES, VAPID, storage secret, webhook signing, GreptimeDB passwords | credential store, runtime-configured in the admin UI | the admin pages; never an environment variable |
| PATs, device tokens, refresh tokens | database, hashed | revoke in settings |

`INITIAL_ADMIN_EMAIL` is not a secret but grants first-admin access: keep it a mailbox you control. The retired key of the old SSH ciphertext leaves the environment with [#84](https://github.com/marinoscar/shellkeep/issues/84).

## 10. Egress

| Destination | Why | Control |
|---|---|---|
| Target servers, port per profile | SSH | host-key pinning; Doctor `ssh-egress` check; no allowlist of hosts (users choose servers), so the API host must not be able to reach internal networks it should not |
| AI providers | model calls | redacted text only; key per user; provider SDKs isolated in one package |
| Webhook receivers | outbound events | the webhooks slice's SSRF guard (private ranges refused unless an admin allows a host), Standard Webhooks signing, payloads of ids and names only |
| Google, SMTP/SES, Web Push, object storage | sign-in, mail, push, files | configured in the admin UI |

**Operator note.** A user can point a server profile at any host the API container can route to. If the API shares a network with internal services, restrict egress at the network layer; ShellKeep does not filter SSH destinations.

## 11. HTTP hardening, validation and uploads

- nginx adds `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS and a per-path CSP (`infra/nginx/csp.conf`, app additions in `app.d/`). The WebSocket location includes the same security-headers snippet.
- Every body and query is validated with Zod (`ZodValidationPipe`); errors publish the path and message, never the submitted value. WebSocket messages are validated by hand: a non-UUID session id is `NOT_FOUND`.
- Uploads (terminal image paste, runbook `file_upload`): size and type limits (100 MiB at the proxy), randomized object keys with the organization segment, stored by the storage slice; a `file_upload` step names a stored object and verifies the checksum on the target (`UPLOAD_CHECKSUM_MISMATCH`).
- No global rate limiter exists; targeted limits are the platform's (AI, device polling, link resolution). Add `limit_req` at the proxy if the deployment is exposed.

### Remote file access

Detail: [specs/files.md](specs/files.md).

- **Access rule.** The same as opening a terminal: `sessions:write` plus the `connect` access check on the profile, on every request. There is no `files:*` permission; a profile the caller may not use is a 404.
- **Download tokens.** Random, stored only as a hash in memory, single use, valid 60 seconds, bound to user, organization, profile, path and size. The download route is public by token, so redemption re-resolves the user (active, still in the organization), requires `sessions:write` and re-checks the connect rule and the size.
- **Paths.** A path reaches SFTP calls, and, for a folder archive only, ONE exec command line: `tar -czf - -C '<parent>' -- '<base>'`, each part single-quoted by `shellQuote` (`files/archive/tar-command.ts`, tested under a real shell with hostile names) after the path was resolved to an absolute one, NUL refused and checked to be a directory. Nothing else is ever interpolated into a command.
- **No content in logs or spans.** File content and paths are never logged or traced (spans carry the profile id) and never sent to AI.
- **Audit.** Every download records `server_profile.file_download`, every completed upload `server_profile.file_upload` and every folder archive `server_profile.folder_archive` (plus `server_profile.folder_archive_download` when a link is issued) (path, size, hostname; never content).

## 12. Audit and logging

- Audit events (`audit_events`, optional retention): `terminal_session.create|terminate`, `server_profile.file_download`, `server_profile.file_upload`, `server_profile.folder_archive` and `server_profile.folder_archive_download` (path, size, hostname), `server_profile.create|update|delete|test|host_key_trusted|host_key_auto_trusted|host_key_replaced|host_key_forgotten|connect_as_grantee`, `terminal_ai.consent|request`, `runbook.created|version_created|archived|restored|deleted`, `runbook_run.created|cancelled|target_cancelled|destructive_confirmed|ai_stopped`, `runbook_schedule.created|updated|deleted|approved|run_now`, `runbook_agent.command`, `snippet.create|update|delete|reorder` (the snippet id only: never a title, body or tag). Plus the platform's identity, settings and sharing events.
- Logs are structured (Pino) with request and trace ids. Never logged: terminal input or output, commands, prompts, model output, credentials, tokens (including the WebSocket `auth` token). Logs carry counts, lengths, risk classes and codes.
- Webhook and notification payloads carry ids, names and times only; their schemas are strict so a secret cannot be added by accident.

## 13. Threat model

| Threat | Mitigation | Residual risk |
|---|---|---|
| Stolen access token | 15 minute TTL, memory-only; WebSocket `exp` timer; revoked devices fail principal checks | live until `exp` |
| Stolen refresh cookie | HttpOnly, rotated on use | |
| Database dump leaked | secrets are ciphertext under `SECRETS_ENCRYPTION_KEY`, per-user sub-keys; fingerprints are public | key and dump together |
| Compromised API host | secrets in memory during calls only; no plaintext at rest | an attacker with the process reads live secrets |
| Man-in-the-middle to a target | host key pinned before any credential; mismatch always refused | trusting the wrong key on first use (user compares out of band) |
| A shared-server editor redirects a connection to steal a credential | credential-holder-only edit of host, port, user and secrets | |
| Terminal output leaks a secret to an AI provider | consent, per-server hard switch, redaction, caps, audit | redaction is heuristic; the switch is the control |
| Prompt injection through target output | the model's output is text; commands need a person, or a policy-checked allowlist that excludes destructive and sensitive commands | `autonomous_within_allowlist` is a deliberate trust grant |
| An AI agent or runbook wipes a fleet | risk classification, typed confirmation, two-person approval, canary, dry run, `maxFailures` budget, cancel | a non-destructive-looking command that destroys (the classifier is a net, not the access model) |
| Command injection through parameters | parameters and secrets travel on stdin as quoted exports, never in argv or interpolated into the body | a script that `eval`s its own parameter |
| Cross-organization access | RLS on org tables, composite foreign keys, 404 rather than 403 | user-owned domain tables rely on code (§8) |
| Viewer types into a terminal | `sessions:write` required at `auth`; sharing adds the RBAC check on top | |
| Idle sessions linger | reaper detaches, terminates and purges | DELETE does not kill the remote tmux session ([specs/terminal.md §7](specs/terminal.md#7-invariants)) |
| Maintenance bypass | window applies to new auth and connect; admins exempt only by setting | |
| Worker node abuse | `nod_` token only on `/api/nodes`; no SSH or AI job is node-eligible | |
| SSRF through webhooks | slice egress guard | |
| Excessive terminal fan-out | per-run `maxConcurrency` and `maxTargetsPerRun`, bounded system settings | |

## 14. Security checklist

- [ ] Every new endpoint declares `@Auth({ permissions })` or `@Public()` with a reason.
- [ ] A new route that touches a server or runbook goes through `AccessPolicy`; a denial is 404.
- [ ] No SSH or provider secret in a log, span, metric label, payload, response, export or prompt.
- [ ] Every new SSH path opens through `SshConnectionFactory`.
- [ ] Terminal text reaches a model only through `TerminalContextService.forAi`.
- [ ] A new job type is in `job-type-snapshot.spec.ts`; SSH and `ai.*` jobs have neither node member.
- [ ] A new WebSocket message is validated and re-checks session ownership.
- [ ] A new org table has forced RLS and composite keys; a new user table is classified in `model-ownership.ts` and `user-owned-models.ts`.
- [ ] A new setting that loosens safety is tighten-only at the organization layer.
- [ ] Docs and the exceptions ledger updated in the same PR.
