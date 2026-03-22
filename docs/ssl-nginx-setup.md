# SSL & Nginx Reverse Proxy Setup for shellkeep.dev.marin.cr

## Overview

ShellKeep is deployed behind a two-tier Nginx reverse proxy on the `dev.marin.cr` VPS, sharing the wildcard SSL certificate and subdomain routing infrastructure with other projects (Knecta, Clipboard, etc.).

This document covers the ShellKeep-specific configuration. For the full infrastructure setup (SSL certificates, host Nginx, DNS), see the [Clipboard SSL/Nginx Setup Guide](../../clipboard/docs/ssl-nginx-setup.md).

## Architecture

```
Internet (HTTPS :443)
|
v
Host Nginx (SSL termination, wildcard cert for *.dev.marin.cr)
|
|   map $host -> $backend_port:
|     shellkeep.dev.marin.cr  -> 127.0.0.1:8323
|
v  127.0.0.1:8323
Docker Compose (bridge + devnet networks)
+-- Nginx container (port 80 -> exposed as 8323)
|   +-- /api/terminal/ws  -> API container (WebSocket, 1hr timeout)
|   +-- /api              -> API container (port 3000)
|   +-- /                 -> Web container (port 80 or 5173)
+-- API container (NestJS + Fastify + WsAdapter)
+-- Web container (React + Vite)
+-- (no DB container -- uses external PostgreSQL via devnet)
```

**Key differences from other projects:**

- **WebSocket support**: The internal Nginx has a dedicated `/api/terminal/ws` location block with 1-hour timeouts and disabled buffering for persistent terminal connections
- **No database container**: Uses external PostgreSQL via the `devnet` Docker network (same as Knecta)
- **WsAdapter**: The NestJS API uses `@nestjs/platform-ws` for WebSocket gateway support alongside Fastify

## Port Assignment

| Project | Port | Subdomain |
|---------|------|-----------|
| Knecta | 8319 | knecta.dev.marin.cr |
| Clipboard | 8320 | clipboard.dev.marin.cr |
| Semantic Convert | 8321 | semantic-convert.dev.marin.cr |
| VitalMesh | 8322 | vitalmesh.dev.marin.cr |
| **ShellKeep** | **8323** | **shellkeep.dev.marin.cr** |

## Step 1: Update Host Nginx Map

Edit `/etc/nginx/sites-available/dev-wildcard` on the VPS and add ShellKeep to the `map` block:

```nginx
map $host $backend_port {
    knecta.dev.marin.cr           8319;
    clipboard.dev.marin.cr        8320;
    semantic-convert.dev.marin.cr 8321;
    vitalmesh.dev.marin.cr        8322;
    shellkeep.dev.marin.cr        8323;    # <-- add this
}
```

Reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

No DNS changes needed -- the wildcard `*.dev.marin.cr` already resolves to the VPS.
No new SSL certificate needed -- the wildcard cert covers all subdomains.

## Step 2: Register Google OAuth Callback

In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), add the following as an authorized redirect URI:

```
https://shellkeep.dev.marin.cr/api/auth/google/callback
```

This must match the `GOOGLE_CALLBACK_URL` in the `.env` file.

## Step 3: Create the Database

Connect to the external PostgreSQL server and create the ShellKeep database:

```bash
psql -h <postgres-host> -U admin -c "CREATE DATABASE shellkeep;"
```

## Step 4: Configure Environment

The `.env` file at `infra/compose/.env` should have:

```env
APP_URL=https://shellkeep.dev.marin.cr
GOOGLE_CALLBACK_URL=https://shellkeep.dev.marin.cr/api/auth/google/callback
POSTGRES_HOST=postgres
POSTGRES_DB=shellkeep
```

The `POSTGRES_HOST=postgres` value refers to the PostgreSQL server hostname on the `devnet` Docker network.

## Step 5: Create devnet Network

If not already created (shared with Knecta and other projects):

```bash
docker network create devnet
```

## Step 6: Deploy

```bash
cd /home/marinoscar/git/shellkeep

# Development
cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml up --build

# Production
cd infra/compose && docker compose -f base.compose.yml -f prod.compose.yml up --build -d
```

Verify:

```bash
curl https://shellkeep.dev.marin.cr/api/health/live
# -> {"data":{"status":"ok"}}
```

## Internal Nginx Configuration

ShellKeep's Docker-internal Nginx (`infra/nginx/nginx.conf`) has a dedicated location block for the terminal WebSocket that differs from other projects:

```nginx
# Terminal WebSocket (before /api block)
location /api/terminal/ws {
    proxy_pass http://api_upstream;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;    # 1 hour for long-lived terminal sessions
    proxy_send_timeout 3600s;
    proxy_buffering off;          # Critical for streaming terminal I/O
}
```

This block must appear **before** the general `/api` block so Nginx matches it first. The 1-hour timeout prevents idle terminal connections from being dropped. Buffering is disabled to ensure real-time terminal output streaming.

The host Nginx wildcard config already forwards WebSocket upgrade headers (`Upgrade` and `Connection`), so no changes are needed at the host level.

## Troubleshooting

**502 Bad Gateway:**
- Docker containers not running: `cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml ps`
- Port mismatch: Verify `8323:80` in `base.compose.yml` matches the host Nginx map entry

**Database connection refused:**
- Ensure `devnet` Docker network exists: `docker network ls | grep devnet`
- Verify PostgreSQL is reachable from the API container: `docker compose exec api sh -c "nc -zv postgres 5432"`
- Verify the `shellkeep` database exists on the PostgreSQL server

**WebSocket / terminal connection failures:**
- Check both Nginx tiers forward `Upgrade` and `Connection` headers
- Verify the `/api/terminal/ws` location block appears before `/api` in `infra/nginx/nginx.conf`
- Check `proxy_read_timeout` is 3600s (not the default 60s) for long-lived sessions
- Ensure `proxy_buffering off` is set for the WebSocket location

**Google OAuth errors:**
- Verify `https://shellkeep.dev.marin.cr/api/auth/google/callback` is registered in Google Cloud Console
- Verify `GOOGLE_CALLBACK_URL` in `.env` matches exactly

**SSL certificate errors:**
- Check cert validity: `sudo certbot certificates`
- Test renewal: `sudo certbot renew --dry-run`

## File Reference

| File | Purpose |
|------|---------|
| `/etc/nginx/sites-available/dev-wildcard` | Host reverse proxy -- subdomain-to-port mapping |
| `/etc/letsencrypt/live/dev.marin.cr/` | Wildcard SSL certificate and key |
| `infra/nginx/nginx.conf` | Docker internal routing (includes WebSocket terminal block) |
| `infra/compose/base.compose.yml` | Docker Compose base services (nginx, api, web on devnet) |
| `infra/compose/dev.compose.yml` | Development overrides (hot reload, volumes) |
| `infra/compose/prod.compose.yml` | Production overrides (resource limits, restart policies) |
| `infra/compose/.env` | Environment variables (DB, OAuth, encryption key) |
