# Platform adoption

This folder holds the frozen baseline for adopting the EnterpriseAppBase `@marinoscar/platform-*` packages in ShellKeep (program #30, epic #31). [module-classification.md](module-classification.md) is the hand-written part: for every top-level directory of `apps/api/src`, `apps/web/src`, `apps/web/src/components`, `apps/web/src/pages` and `infra` it records a category (noise, backport, domain or shellkeep-divergence), the target slice or package, the roadmap issue that deals with it, and the workaround for each backport. The Prisma models and migrations are classified there too. The measurements it rests on are pinned to EnterpriseAppBase `6ea11ed` and ShellKeep `95145d0` (2026-11-23).

The four `drift-baseline*` files are the raw reports. `drift-baseline.md` and `.json` compare ShellKeep against EAB's `apps/` layout (the apps view; right for web, prisma and infra). `drift-baseline-slices.md` and `.json` pair each ShellKeep API base module with its packaged slice (the slice view; right for the API, because EAB's `apps/api/src` now holds only bindings). To regenerate, run EAB's `scripts/platform-drift.mjs` twice from a scratch directory (never from inside either repository) and build the slice view with the helper in this repository:

```bash
node <EAB>/scripts/platform-drift.mjs --app <SHELLKEEP> --base <EAB> --out <SCRATCH>/apps \
  --app-product-name ShellKeep --app-repo-slug marinoscar/shellkeep
bash <SHELLKEEP>/scripts/platform-adoption/make-slice-view.sh <EAB> <SCRATCH>/eab-slice-view
node <EAB>/scripts/platform-drift.mjs --app <SHELLKEEP> --base <SCRATCH>/eab-slice-view --areas api --out <SCRATCH>/slices \
  --app-product-name ShellKeep --app-repo-slug marinoscar/shellkeep
```

The four drift files are generated data and are never edited by hand, apart from replacing local absolute paths. For the committed baseline the replacement was:

```bash
sed 's#/tmp/claude-0/-home-user/de41ec86-cb42-5a40-8317-7f15fd945067/scratchpad/drift/eab-slice-view#<SCRATCH>/eab-slice-view#g; s#/home/user/EnterpriseAppBase#EnterpriseAppBase#g; s#/home/user/shellkeep/worktrees/drift-baseline#shellkeep#g' drift-report.{md,json}
```

(applied to each of the four generated `drift-report.*` files, which were saved as the four `drift-baseline*` names; the slice view's base root, a scratch directory, is written `<SCRATCH>/eab-slice-view`). They are a baseline: a later re-run goes to new files, never over these. Leave them byte-for-byte as committed.

`npm run check:classification` (also a CI step) fails when a top-level directory under the classified roots has no row in `module-classification.md`.

## Rollback tag

The rollback point of the whole program is the `MonoRepo` tag, on `95145d0d850a4a53757b65d289158d58e34fc33d` (the commit these reports measure). It is pushed to `origin`; check it with `git ls-remote --tags origin MonoRepo`. The tag is never deleted.

[local-exceptions.md](local-exceptions.md) lists every place ShellKeep deviates from the platform on purpose (shims, declared database deviations, standing constraints) and the issue that removes each one.

## After adoption (#83)

`drift-after.{md,json}` (apps view) and `drift-after-slices.{md,json}` (slice view) are the re-measurement against EnterpriseAppBase `ad57217` and ShellKeep `a0acaae`; [module-classification.md](module-classification.md#status-after-adoption) records the status per row. Re-run with the commands above, from a scratch directory, into new `drift-after-<date>*` names (never over the baseline or a previous report); EnterpriseAppBase's `docs/ADOPTING-THE-PLATFORM.md` section 8 asks for it occasionally. Normalise local paths as for the baseline (the app root becomes `shellkeep`, the EnterpriseAppBase checkout `EnterpriseAppBase`).

## The shim check

`npm run check:shims` (a CI step in the `check` job, unit-tested by `npm run test:scripts`) keeps [local-exceptions.md](local-exceptions.md) honest. It fails when:

- a `PLATFORM-ADOPTION-SHIM(#<issue>)` marker in `apps/*/src`, `apps/api/prisma` or `infra/` is malformed, or its file is named by no row of the "Code shims" table;
- a "Code shims" row names a file that carries no marker (a resolved shim: delete the row);
- a `platform.lock` `deviations[].id` has no "Database deviations" row, or the reverse;
- a row in "Database deviations", "Code shims", "Standing constraints" or "Drift allowlist" has an empty "Removed by", or, in the main table of a section, one that is not an issue or PR number, a seam request link or `Permanent: <reason>`.

A new workaround therefore needs the marker and the row in the same PR. `npm run check:classification` is the companion check for the classification table.
