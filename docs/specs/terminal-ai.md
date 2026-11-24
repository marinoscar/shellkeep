# Terminal AI

> **Audience:** developers · Code: `apps/api/src/terminal-ai/`, `apps/api/src/command-safety/`, `apps/web/src/components/terminal/ai/` · Related: [terminal.md](terminal.md), [SECURITY-ARCHITECTURE.md §6](../SECURITY-ARCHITECTURE.md#6-terminal-content-and-ai), the platform [AI platform spec](https://github.com/marinoscar/EnterpriseAppBase/blob/main/docs/specs/ai-platform.md)

## 1. Purpose

Three assistants for the terminal, built on the platform AI slice with the user's **own** provider key:

| Feature id | What | Entry point |
|---|---|---|
| `terminal_assist` | turn a plain-language request into one suggested command for this server | `POST /api/ai/terminal/assist` (SSE) |
| `terminal_explain` | explain a selection or the last error | `POST /api/ai/terminal/explain` (SSE), `POST .../explain/preview` |
| `session_summary` | summarize a whole session in the background | `POST /api/ai/terminal/sessions/:id/summaries` (202), job `ai.session.summarize` |

The feature ids are registered in `apps/api/src/app-registrations/ai.ts` (together with the runbook ones, [fleet-runbooks.md §7](fleet-runbooks.md#7-ai-step-and-drafting)) and are permanent: they key usage records and `GET /api/ai/features`. Terminal output is the most sensitive text the product touches, so this spec is mostly about what stands between a pane and a provider.

## 2. Model

### 2.1 The one door

Every feature that needs terminal text calls `TerminalContextService.forAi(scope, sessionId, options)` (`terminal-context.service.ts`). In order:

1. **Load the session** (owner and organization; no access is a 404).
2. **Consent**: when the effective policy requires it and the user has not accepted, `409 AI_CONSENT_REQUIRED`.
3. **Per-server switch**: `server_profiles.ai_output_sharing = false` yields `409 AI_OUTPUT_SHARING_DISABLED` for explain and summary. Command assist degrades instead: it receives metadata only (OS, shell, distribution, package manager, working directory), `sharing: 'metadata_only'`, empty text.
4. **Capture** the pane through `SessionHistoryService` (the only reader), or take the client's selection (explain).
5. **Strip** ANSI and control sequences (`strip-ansi.ts`).
6. **Redact** the **whole** text with `redactText` in the organization's mode, then **cap**: capping first could cut a private-key block in half and leave its tail unredacted.
7. **Audit** one `terminal_ai.request` event: purpose, finding counts and sizes, **never** content.

The caps (`TERMINAL_AI_LIMITS`), always dropping the oldest text: assist 40 lines, explain 200 lines or a selection of at most 16 KiB (bytes, trimmed at a code-point boundary), summary 200,000 characters. The user's prompt is redacted too (assist prompt at most 2,000 characters).

### 2.2 Redaction

`redactText(text, { mode, extraLiterals })` replaces matches with `[REDACTED:<kind>]` and returns counts per kind, never the matched text. Rules run whole-block first:

<!-- redaction-kinds:start -->
`aws_access_key`, `aws_secret`, `github_token`, `slack_token`, `google_api_key`, `llm_key`, `jwt`, `private_key`, `url_credentials`, `auth_header`, `kv_secret`, `platform_token`, `literal`, `high_entropy`
<!-- redaction-kinds:end -->

`private_key` swallows a PEM block (even an unterminated one); `url_credentials` keeps scheme and host; `kv_secret` keeps the key and replaces the value of anything named password, secret, token, api key; `platform_token` covers `pat_`, `oat_`, `ort_`, `nod_`; `literal` removes exact values the caller passes (a runbook's secret parameters); `high_entropy` removes long random-looking runs but spares UUIDs, git hashes and `sha256:` digests. Mode `strict` additionally replaces every line that had a finding with `[REDACTED LINE]`. Redaction is **defence in depth**; the per-server switch is the control that holds. The table of rules is data in `command-safety/redact.ts`; each rule has a unit test in `redact.spec.ts`.

### 2.3 Settings, consent and the organization layer

| Namespace | Field | Default | Meaning |
|---|---|---|---|
| system `terminalAi` | `redactionMode` | `standard` | `strict` also drops finding lines |
| system `terminalAi` | `requireConsent` | `true` | users must accept before output reaches a model |
| user `terminalAi` | `consentAcceptedAt` | null | set by `POST /api/ai/terminal/consent` (audited `terminal_ai.consent`) |
| per server | `aiOutputSharing` | `true` | the hard control |

An organization can only **tighten** (`strict` wins; consent required wins): `tightenTerminalAiSettings`. `GET /api/ai/terminal/consent` returns `{ required, consentAcceptedAt, redactionMode }`. The web shows `TerminalAiConsentDialog` before the first request.

### 2.4 Command assist

Input `{ sessionId, prompt, includeScreen }` (`includeScreen` defaults to true). The model gets server facts, the redacted screen wrapped in `<terminal_output>` and labelled untrusted, and the request; it must answer with a `COMMAND:` line. The stream is `context { os, shell, cwd, screenLines, findings }`, `delta { text }`, then one `result { command, explanation, risk, destructive, reasons }` or `error { code: AI_ASSIST_UNPARSEABLE }`. **Risk is computed by `classifyCommand`** (`destructive-patterns.ts`), never by the model. The command is returned as text: the web inserts it at the prompt through `insertCommand` for the user to read and press Enter; nothing runs it. `includeScreen: false` captures no pane text even where the server shares it.

### 2.5 Explain

Input is `{ mode: 'last_output' | 'selection', sessionId, selection? }` (a discriminated union). Stream: `context { findings, lines, truncated }`, `delta`, `result { markdown }`, or `error { code: AI_EXPLAIN_EMPTY }`. A suggested fix carries its `classifyCommand` risk. `POST /api/ai/terminal/explain/preview` runs the same checks and redaction and returns `{ text, findings, truncated }` with **no model call**, so the UI can show exactly what would be sent. The web renders the answer through `SafeMarkdown` (no raw HTML).

### 2.6 Session summaries

`POST /api/ai/terminal/sessions/:id/summaries` answers what it can without reading the pane: 404 not yours, 400 `SESSION_TERMINATED` for an ended session, 409 consent and per-server switch. It inserts a `terminal_session_summaries` row (`pending`) and enqueues **`ai.session.summarize`** (subject `terminal_session` + session id, deduplicated). `GET .../summaries` lists the newest 20; `GET .../summaries/:summaryId` reads one. A row still `pending` after 60 minutes is shown failed (`SUMMARY_TIMED_OUT`).

The handler (`profile: { maxRuntimeMs: 10 min, maxAttempts: 3 }`) re-checks consent and the switch (the job runs later, without the request), reads the pane through `forAi` (up to 200,000 characters), and calls the model through `AiService.forUser(..., { feature: 'session_summary' })`. Text over 60,000 characters is summarized in parts: one `respond` per chunk extracts notes, one `respondStructured` merges them. The answer is redacted again and capped before it is stored: `summary_md`, `commands` (`[{ command, outcome? }]`), `findings` (kinds and counts), `source_chars`, `truncated`, `model`. The table never holds terminal text. A provider throttle defers the job; a condition no retry fixes (consent withdrawn, switch off, no key, session gone) marks the row `failed` with `AI_CONSENT_REQUIRED`, `AI_OUTPUT_SHARING_DISABLED`, `SESSION_NOT_FOUND`, `SESSION_EMPTY` or `SUMMARY_FAILED` and ends cleanly. The payload carries ids only. The job is server-only (no `nodeResultSchema`, no `persistNodeResult`).

### 2.7 Authorization and guards

Assist, explain and summaries need `ai:use` (and `sessions:read`, checked in the controller) and sit behind the platform's AI enablement guard and `AiOrgEnabledInterceptor`: with AI off they answer 403 `AI_DISABLED`. A refusal before the first SSE frame is plain JSON; a failure after it is an in-band `error` frame. Keys are the caller's own (`AiService.forUser`); there is no deployment fallback key for these features.

### 2.8 Web

`TerminalAiPanel` (a sibling of the panes at `md` and up) hosts `CommandAssistPanel` and `ExplainPanel`; `ExplainMenuButton` explains the current selection; `SessionSummaryDrawer` and `SessionSummaryPanel` read summaries. Availability (`useTerminalAiAvailable`) requires the deployment's `ai` feature on and `ai:use`; it fails closed while the AI config is unknown. Keyboard shortcuts `terminal.aiAssist` and `terminal.aiExplain` live in the `shortcuts` namespace. Hooks: `useCommandAssist`, `useTerminalExplain`, `useSessionSummary`.

## 3. Flows

```
assist:  panel ─ POST assist ─> consent? switch? ─> capture ─> strip ─> redact ─> cap ─> audit ─> model ─> frames
summary: POST ─> row(pending) + job ─(later)─> re-check ─> capture ─> redact ─> model(s) ─> redact ─> row(succeeded|failed)
```

## 4. Extending it

- **A new AI feature over terminal text.** Register an id in `app-registrations/ai.ts` (lower snake case, permanent), add a purpose to `FEATURE_FOR_PURPOSE`, call `TerminalContextService.forAi` (never `SessionHistoryService` directly: the capture-boundary spec fails), call the model only through `AiService.forUser(userId, { orgId, feature })`, compute any risk with `classifyCommand`, and return commands as text. A background variant is a job type with no node members, added to `job-type-snapshot.spec.ts` ([add-job-type skill](../../.claude/skills/add-job-type/SKILL.md)).
- **A new secret pattern.** Add a rule (and a kind in `REDACTION_KINDS`) in `command-safety/redact.ts` with positive and negative cases in `redact.spec.ts`; the metric label set follows the kinds. Rules are ordered: specific before generic.
- **A new destructive pattern.** Add to the table in `command-safety/destructive-patterns.ts` with a test; it also feeds runbook risk and the AI step policy.
- **A new size cap.** `TERMINAL_AI_LIMITS`; document it in 2.1.
- **A new error code.** `terminal-ai.error-codes.ts` (`registerErrorCode`), then the web's mapping.

## 5. Invariants

1. Terminal text reaches a model only through `forAi`; `capture-pane` appears only in `SessionHistoryService`.
2. A server with `aiOutputSharing = false` never has its output sent: assist sees metadata only, explain and summary refuse.
3. Consent is enforced server-side, per request and again in the summary job.
4. Redaction runs on the whole text before capping, with the organization's mode; an organization can only tighten.
5. No log, span, audit event, metric label, job payload or summary row holds terminal text, a prompt, or a matched secret: findings are a kind and a count.
6. Risk and destructiveness are computed by `classifyCommand`; a model's opinion is never trusted; a suggested command is never executed by the API.
7. AI keys are the user's own and never leave the server; `ai.session.summarize` is server-only.
8. `terminal_assist`, `terminal_explain`, `session_summary` ids and the job type string are permanent.

## 6. Tests

`apps/api/test/terminal-ai/` (`terminal-context`, `terminal-assist`, `terminal-explain`, `session-summary` integration, `capture-boundary.spec.ts`), unit specs beside the code (`redact.spec.ts`, `classify-command.spec.ts`, the parsers, `terminal-ai.settings.spec.ts`, `session-summarize.handler.spec.ts` against the platform's job-handler conformance kit), the `ai-*` platform conformance suites, and `apps/api/test/docs-consistency.spec.ts` for the redaction kinds listed in 2.2 ([TESTING.md](../TESTING.md)).
