# Local exceptions (fixture)

## Database deviations (declared in `platform.lock`)

| Deviation id | What differs | Where | Why | Removed by |
|---|---|---|---|---|
| `example:domain-schema` | Domain tables | `apps/api/prisma/platform.lock` | Created outside the platform | Permanent: a record of the baseline |

## Code shims (`PLATFORM-ADOPTION-SHIM`)

| Shim | Where | What it does | Removed by |
|---|---|---|---|
| Demo shim | `apps/api/src/demo/shim.ts` | A workaround | #901 |
| Demo location | `infra/nginx/demo.conf` | A proxy workaround | Seam request example-org/platform#12 |

### Decisions

| Decision | Detail | Removed by |
|---|---|---|
| A decision | Why | Kept |

## Standing constraints

| Constraint | Detail | Removed by |
|---|---|---|
| A constraint | Why | Permanent: single organization |

## Drift allowlist

| Entry | Reason | Added by |
|---|---|---|
| _none yet_ | | |
