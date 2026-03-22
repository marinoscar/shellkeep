# Docker Compose Project Name Conflict - Problem & Fix

## Date

2026-03-22

## Problem

When launching ShellKeep with `docker compose`, the containers would collide with VitalMesh's containers. ShellKeep's nginx would bind to port 8322 (VitalMesh's port) instead of 8323, and the browser showed `ERR_EMPTY_RESPONSE` when accessing `shellkeep.dev.marin.cr`.

## Root Cause

Docker Compose derives the **project name** from the working directory name when no explicit name is set. All projects on this VPS use the same directory structure:

```
<project>/infra/compose/base.compose.yml
<project>/infra/compose/dev.compose.yml
<project>/infra/compose/.env
```

When running `cd infra/compose && docker compose up`, the working directory is always `compose`, so Docker Compose assigns the project name `compose` to every project. This means:

- All projects create containers named `compose-api-1`, `compose-nginx-1`, `compose-web-1`
- All projects share the same `compose_app-network` Docker network
- Whichever project starts last overwrites the containers of the previously running project
- Port bindings, environment variables, and images all get mixed up between projects

This is why ShellKeep's nginx ended up on port 8322 (VitalMesh's port) -- Docker Compose thought it was managing the same `compose` project and reused VitalMesh's configuration.

## Symptoms

- `ERR_EMPTY_RESPONSE` in the browser (host Nginx maps `shellkeep.dev.marin.cr` to port 8323, but the container was on 8322)
- `docker compose ls` shows only one `compose` project even though multiple projects should be running
- Container names like `compose-api-1` with no indication of which project they belong to
- Starting one project silently stops another project's containers
- `docker compose ps` from one project's directory shows containers from a different project

## Fix

Add `COMPOSE_PROJECT_NAME` to each project's `infra/compose/.env` file:

```env
# Docker Compose project name (avoids conflicts with other projects sharing infra/compose/ path)
COMPOSE_PROJECT_NAME=<project-name>
```

This was applied to all projects:

| Project | `COMPOSE_PROJECT_NAME` | File |
|---------|----------------------|------|
| ShellKeep | `shellkeep` | `/home/marinoscar/git/shellkeep/infra/compose/.env` |
| VitalMesh | `vitalmesh` | `/home/marinoscar/git/vitalmesh/infra/compose/.env` |
| Knecta | `knecta` | `/home/marinoscar/git/Knecta/infra/compose/.env` |
| Clipboard | `clipboard` | `/home/marinoscar/git/clipboard/infra/compose/.env` |
| Semantic Convert | `semantic-convert` | `/home/marinoscar/git/semantic-convert/infra/compose/.env` |

### Migration Steps (for already-running projects)

When a project is already running under the wrong name (`compose`), you must stop it with the old name first:

```bash
# 1. Stop the project under its old (wrong) name
cd <project>/infra/compose
docker compose -p compose -f base.compose.yml -f dev.compose.yml down

# 2. Add COMPOSE_PROJECT_NAME to .env (already done above)

# 3. Start with the correct name (now automatic from .env)
docker compose -f base.compose.yml -f dev.compose.yml up -d
```

If you skip step 1, the old containers remain running as orphans and occupy the port.

## Result After Fix

```
$ docker compose ls
NAME                STATUS
shellkeep           running(3)
vitalmesh           running(3)
semantic-convert    running(3)
postgres            running(1)

$ docker ps --format "table {{.Names}}\t{{.Ports}}"
NAMES                      PORTS
shellkeep-nginx-1          0.0.0.0:8323->80/tcp
shellkeep-api-1            3000/tcp
shellkeep-web-1            5173/tcp
vitalmesh-nginx-1          127.0.0.1:8322->80/tcp
vitalmesh-api-1            3000/tcp
vitalmesh-web-1            5173/tcp
semantic-convert-nginx-1   0.0.0.0:8321->80/tcp
...
```

Each project now has:
- Its own named containers (`shellkeep-api-1`, `vitalmesh-api-1`, etc.)
- Its own Docker network (`shellkeep_app-network`, `vitalmesh_app-network`, etc.)
- Independent lifecycle -- starting/stopping one project does not affect others

## Prevention

For any new project using the `infra/compose/` directory structure, always add `COMPOSE_PROJECT_NAME=<project-name>` to the `.env` file before the first `docker compose up`. This should also be added to `.env.example` as a reminder.
