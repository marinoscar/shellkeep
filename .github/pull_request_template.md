## Summary

<!-- Brief description of the changes in this PR -->

## Linked issue

<!-- Fixes #123 / Relates to #123. Every feature or bug fix needs a tracking issue and its own worktree (see AGENTS.md). chore/docs/refactor need none. -->

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] Refactoring (no functional changes)
- [ ] CI/CD or infrastructure change

## Changes Made

-
-
-

## Checks run

<!-- Check the commands you ran; see docs/TESTING.md. Say why for any you could not run. -->

- [ ] `cd apps/api && npm test`
- [ ] `cd apps/web && npm run test:run`
- [ ] `npm run typecheck` in each app touched (`apps/api`, `apps/web`)
- [ ] AI-config and docs-link guards (`apps/api/test/ai-assistant-config.spec.ts`, `apps/api/test/docs-links.spec.ts`)
- [ ] OpenAPI regenerated and linted (routes changed)
- [ ] Manual check (terminal I/O, reconnect, mobile key bar, touch scroll, keyboard inset at phone width) when the terminal UI or gateway changed

## Migrations

<!-- Check the one that applies -->

- [ ] No database change
- [ ] New migration added (never edit an applied or installed one); applied to an empty database and to one with prior migrations
- [ ] Platform migration or `platform.lock` change (at most one open PR may carry this)

## Docs updated

<!-- Check the one that applies -->

- [ ] Spec (`docs/specs/*.md`)
- [ ] Runbook (`docs/runbooks/*.md`)
- [ ] README or `docs/*.md`
- [ ] AGENTS.md / CLAUDE.md
- [ ] None needed

## Rollback

<!-- How to undo this change safely: revert the PR, and anything else (migration down-path, setting to flip, data to restore). If a revert is not enough, say so. -->

## Checklist

- [ ] I have performed a self-review of my own code
- [ ] My changes generate no new warnings
- [ ] No secrets, SSH credentials, hostnames or user data in code, tests, logs or examples
- [ ] Any dependent changes have been merged and published

## Additional Notes

<!-- Add any additional notes for reviewers -->
