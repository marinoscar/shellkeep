# Working with Claude Code and OpenCode

> **Audience:** engineers using AI assistants on this repository · **Rules:** [AGENTS.md](../AGENTS.md) · **Guards:** `apps/api/test/ai-assistant-config.spec.ts`, `apps/api/test/docs-links.spec.ts`

Two assistants work on this repository: Claude Code (Anthropic models) and OpenCode (a local open-weight model behind an OpenAI-compatible server). Both read one shared rule set, `AGENTS.md`. This page says where each file lives, how the tools share them and how the guards keep them in step.

Items marked **verify** depend on the tool version you run. Check them against the tool's own docs.

## 1. Which tool

| Task | Tool |
|---|---|
| Large or cross-cutting change (API + web + database), migrations, security-sensitive work, review | Claude Code |
| A scoped task in one area (one endpoint, one component, one test file) | OpenCode, local model |
| Mechanical work (typecheck, rebuilds, small doc fixes) or offline work | OpenCode, local model |

**`AGENTS.md` is the single shared rule set.** Edit rules there. Never copy a rule into `CLAUDE.md`, an agent file or `opencode.json`.

## 2. File map

| File | Read by | Purpose | Size budget |
|---|---|---|---|
| `AGENTS.md` | OpenCode; Claude Code via `CLAUDE.md` | Shared rules: structure, every MANDATORY section, commands | 24 KB (24576 bytes) |
| `CLAUDE.md` | Claude Code | `@AGENTS.md` import, then Claude-only content: docs table, delegation rules, cloud-session exception | none |
| `apps/api/AGENTS.md`, `apps/web/AGENTS.md` | OpenCode when working in that folder | Area rules | 6 KB (6144 bytes) each |
| `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md` | Claude Code | Exactly `@AGENTS.md` | n/a |
| `.claude/agents/*.md` | Claude Code | Subagents: `name`, `description`, optional `model` | none |
| `.opencode/agents/*.md` | OpenCode | Subagents: `description`, `mode`, `temperature`, `steps`, `permission` | 6 KB each |
| `.claude/skills/<name>/SKILL.md` | Claude Code; OpenCode also reads it | On-demand recipes (`add-job-type`, `add-settings-page`, `add-notification`, `platform-migration`) | 10 KB each |
| `.opencode/skills/<name>/SKILL.md` | OpenCode | Byte-identical twins of the four skills | same file |
| `opencode.json` | OpenCode | Model, provider, compaction, watcher, permissions | none |

Load order: Claude Code loads `CLAUDE.md`, `@AGENTS.md` inlines the shared rules, agents and skills load on demand. OpenCode loads `AGENTS.md`, reads a nested `AGENTS.md` when you work in its folder (**verify**), and falls back to `CLAUDE.md` only when no `AGENTS.md` exists. Keep `instructions` out of `opencode.json`.

## 3. Claude Code versus OpenCode

| Aspect | Claude Code | OpenCode |
|---|---|---|
| Rules file | `CLAUDE.md` (imports `@AGENTS.md`) | `AGENTS.md` |
| Agent location and frontmatter | `.claude/agents/`; `name`, `description`, `model` | `.opencode/agents/`; `description`, `mode: subagent`, `temperature`, `steps`, `permission` (name from the file name) |
| Permissions | `permissions.allow` in `.claude/settings*.json` | `permission` in `opencode.json` and in agent frontmatter; the last matching rule wins (**verify**) |
| Models | Anthropic | `local/local-coder` for `model` and `small_model` |

`.opencode/agents/*` allow read-only git and test commands, deny state-changing git (commit, push, checkout, merge, rebase, reset, worktree and similar) and ask for other bash commands. `ops-dev` also sets `edit: deny`. `opencode.json` asks before `git push*`, `git commit*`, `rm -rf*` and `webfetch`.

## 4. Local model setup

`opencode.json` reads the base URL from the environment and never carries a host name or address:

```bash
export OPENCODE_LOCAL_BASE_URL=http://127.0.0.1:8080/v1
```

For machine specifics, override in `~/.config/opencode/opencode.json`, not in the repository file.

Serve the model with an OpenAI-compatible server (for example llama.cpp's `llama-server`):

- `--alias local-coder` is required: it must match the key under `provider.local.models`.
- `--jinja` uses the model's chat template, which tool calling needs. Use an Instruct build and the template shipped in the model file.
- `-c` is the **total** context shared by all slots; per-slot context is `-c / slots`. `opencode.json` assumes 98304 tokens per slot, so use `-c` = 98304 x slots.
- Check the server with `curl $OPENCODE_LOCAL_BASE_URL/models`; it should list `local-coder`.

| Symptom | Likely cause | Fix |
|---|---|---|
| Tool call printed as text | Missing `--jinja` or wrong template | Add `--jinja`, use the official template |
| JSON parse error on a file write | Large argument truncated | Ask for smaller edits; prefer Edit over Write |
| Long stall | Thinking mode | Use the Instruct build |
| 400 error about context | `-c` below slots x 98304 | Fix `-c` |
| "model not found" | `--alias` mismatch | Restart with `--alias local-coder` |

Flag spellings change between server builds; **verify** with the server's `--help`.

## 5. Working within a small context window

| Practice | How |
|---|---|
| One agent at a time | The main agent plans; one subagent works. Two or three in parallel at most |
| One worktree per agent | `git worktree add worktrees/<short-name> -b <type>/<short-name>`; never two agents in one tree |
| Read docs by section | `grep -n '^#' docs/<file>.md`, then Read with `offset` and `limit` |
| Hand over a pointer | Give the subagent the doc path and section, not the text |
| Compaction | `opencode.json` sets `compaction.auto`, `prune` and `reserved`; run `/compact` by hand when a session gets long |
| Area rules | Nested `AGENTS.md` files hold them, so the root file stays small |

## No real people, companies or user material

The root `AGENTS.md` carries the short rule; this is the full text.

- **Material a user shares is never reused.** Never use the content of documents, notes, transcripts, screenshots, terminal output or any other material the user shares with an assistant, or anything derived from it (names, numbers, quotes, hostnames), in code, tests, fixtures, prompts, documentation, examples, issues, pull requests or commit messages. Shared material is used only to diagnose the problem in the conversation.
- **No real names as examples.** Never use the name of a real person, or a real company, organization, product, brand or host, as an example anywhere in the repository. Use clearly invented placeholders: `Person A`, `Avery Example`, `Org Alpha`, `Org Beta`, `Product X`, `Project P1`, `server-a.example.test`, and `@example.test` email addresses. Do not borrow well-known fictional brands either.
- **Exempt, and only these:** a real vendor or service a feature integrates by name (a provider adapter calling that vendor's API, its SDK package names, documented endpoints), and legal or authorship metadata (package `author`, copyright lines).
- **Fix what you find.** When you find a real name used as an example, replace it with a placeholder in the same change.

## 6. Maintenance

| Change | Do this |
|---|---|
| Change a rule | Edit `AGENTS.md` (or the nested one for an area). Keep `AGENTS.md` at 24 KB or less and nested files at 6 KB or less |
| Claude-only content | Edit `CLAUDE.md` below the `@AGENTS.md` line |
| Add or change an agent | Edit **both** `.claude/agents/<name>.md` and `.opencode/agents/<name>.md`; the parity guard fails when the sets differ |
| Add or change a skill | Edit `.claude/skills/<name>/SKILL.md`; if a twin exists in `.opencode/skills/`, copy it over (the guard requires byte-identical twins) |
| Add a doc | Link it from [README.md](README.md) |
| `opencode.json` | Keep it free of `instructions` and of machine-specific values |

Guards (run from `apps/api`):

- `test/ai-assistant-config.spec.ts`: size budgets, agent parity, OpenCode frontmatter and git-deny permissions, skill frontmatter and twins, `CLAUDE.md` imports, `opencode.json`, rule headings.
- `test/docs-links.spec.ts`: relative links in the docs, `AGENTS.md` and `CLAUDE.md` files, `.opencode/agents`, `.claude/agents` and `.claude/skills`.

```bash
cd apps/api && npx jest --config ./test/jest.config.js --runTestsByPath test/ai-assistant-config.spec.ts test/docs-links.spec.ts
wc -c AGENTS.md apps/*/AGENTS.md .opencode/agents/*.md
```
