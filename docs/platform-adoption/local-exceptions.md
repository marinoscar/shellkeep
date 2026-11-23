# Local exceptions to the platform

Every place where ShellKeep deviates from `@marinoscar/platform-*` on purpose, and the issue that removes it. Introduced by #40 (epic #31), completed by #83. An exception without a row here is a bug. At the baseline commit there are none: ShellKeep has not adopted any package yet.

## How to use this page

- **A shim in code** carries the comment `// PLATFORM-ADOPTION-SHIM(<issue>)`, where `<issue>` is the issue that removes it. List them all with `grep -rn "PLATFORM-ADOPTION-SHIM" apps/api/src`.
- **A deviation in the database** is an entry under `deviations` in `apps/api/prisma/platform.lock` (created by #45).
- **The PR that removes an exception deletes its row here.** It also removes the marker, the lock deviation and any allowlist entries it names.
- A new exception adds a row in the same PR, with an issue that removes it. If no issue exists, file one.

## Database deviations (declared in `platform.lock`)

| Deviation id | What differs from the platform | Where | Why | Removed by |
|---|---|---|---|---|
| _none yet_ | | | | |

The expected first entry is the domain schema (`server_profiles`, `terminal_sessions`, enums and indexes that platform `0001` does not create), declared by #45.

## Code shims (`PLATFORM-ADOPTION-SHIM`)

| Shim | Where | What it does | Removed by |
|---|---|---|---|
| _none yet_ | | | |

## Standing constraints

| Constraint | Detail | Resolved by |
|---|---|---|
| `MonoRepo` rollback tag missing | The tag is to be placed on `95145d0d850a4a53757b65d289158d58e34fc33d`. Pushing it was blocked by the agent session's git proxy. A maintainer must run `git tag MonoRepo 95145d0 && git push origin MonoRepo`. #43 and the cutover runbook (#84) depend on it. | A maintainer pushes the tag |

## Drift allowlist

Intentional schema drift that the drift checks must accept (raw-SQL partial indexes, row-level-security policies). Empty at the baseline; the entries are added by #45 and the slice issues that introduce them, each with a reason.

| Entry | Reason | Added by |
|---|---|---|
| _none yet_ | | |
