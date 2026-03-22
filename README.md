# ShellKeep

Your terminal sessions, alive and waiting — on every server, from any device.

---

## The Era of Parallel Infrastructure

AI coding agents don't sleep. They SSH into staging, run migrations, tail logs, and deploy builds — all at the same time, across multiple servers. Meanwhile, you're switching between your laptop, a cloud workstation, and a tablet on the couch.

The old model — open a terminal, SSH in, lose it when you close the lid — doesn't work anymore. ShellKeep is the command center built for how modern developers and their agents actually work. Every session persists. Every server profile is stored securely. Every connection is one click away, from anywhere.

---

## The Problem

- You close your laptop and your SSH session dies. The process you were watching is gone.
- Your SSH credentials live in `~/.ssh/config` on one machine, nowhere else.
- You have six servers across three projects and no organized way to track what's running where.
- Your AI agent needs to authenticate headlessly to a service — there's no OAuth flow for that.
- Your team needs access to shared infrastructure, but you don't want to hand out SSH keys.

---

## Key Features

### Persistent Terminal Sessions

Sessions are backed by tmux. Close your browser, shut your laptop, come back tomorrow — your session is exactly where you left it. Processes keep running. Output keeps scrolling. Reconnect in seconds.

### Encrypted Server Profiles

Save your SSH connection details once. Credentials are encrypted at rest with AES-256-GCM. No more copying keys between machines or keeping a notes file with hostnames and ports.

### Multi-Device Access

ShellKeep runs in the browser. Open it on your workstation, your laptop, your phone. Every session, every server profile, every piece of terminal output — always in sync, always accessible.

### Dashboard with Quick Connect

See all your active and recent sessions at a glance. One click to reconnect. No hunting through terminal tabs or remembering which window had which server.

### Full Terminal Emulation

Powered by xterm.js. Handles color output, cursor movement, wide characters, and everything else your shell throws at it. Copy output to clipboard, download session logs, work across multiple tabs.

### Device Authorization (RFC 8628)

CLI tools and headless agents can authenticate without a browser flow. A device requests a code, you approve it in the UI, the agent gets a token. Standard OAuth device authorization — your scripts and AI agents authenticate cleanly.

### Team Access Control

Email allowlist keeps access locked to the people you invite. RBAC with three roles — Admin, Contributor, and Viewer — controls what each person can see and do. Admins manage users and system settings. Contributors manage their own sessions and profiles. Viewers get read access.

### Dark Mode and Responsive UI

Built with Material UI. Dark mode by default, because terminals. Responsive layout that works on every screen size.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript, Material UI |
| Backend | NestJS + Fastify, Node.js |
| Database | PostgreSQL, Prisma ORM |
| Terminal | xterm.js, WebSocket I/O |
| Auth | Google OAuth, JWT with refresh token rotation |
| Infra | Docker, Docker Compose, Nginx |
| Observability | OpenTelemetry, Uptrace, Pino |

---

## Quick Start

**Prerequisites:** Docker Desktop, a PostgreSQL instance, Google OAuth credentials.

```bash
# 1. Clone the repository
git clone git@github.com:marinoscar/shellkeep.git
cd shellkeep

# 2. Copy the environment template
cp infra/compose/.env.example infra/compose/.env

# 3. Fill in your credentials in infra/compose/.env
#    - POSTGRES_HOST (your PostgreSQL host)
#    - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
#    - JWT_SECRET (min 32 chars)
#    - ENCRYPTION_KEY (openssl rand -base64 32)
#    - INITIAL_ADMIN_EMAIL

# 4. Create the shared Docker network (one-time)
docker network create devnet

# 5. Start the development stack
cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml up
```

ShellKeep is now running:

- **Application:** http://localhost:8323
- **API + Swagger:** http://localhost:8323/api/docs

To start with the full observability stack (Uptrace traces and metrics):

```bash
cd infra/compose && docker compose -f base.compose.yml -f dev.compose.yml -f otel.compose.yml up
# Uptrace UI: http://localhost:14318
```

For production:

```bash
cd infra/compose && docker compose -f base.compose.yml -f prod.compose.yml up -d
```

---

## Architecture

ShellKeep uses same-origin hosting via Nginx. The UI is served at `/`, the API at `/api`, and the Swagger docs at `/api/docs` — all from a single domain. No CORS, no cross-origin token juggling.

Terminal I/O flows over a WebSocket connection (`/api/terminal/ws`) directly to the NestJS gateway, which manages tmux sessions on the host. SSH credentials are encrypted with AES-256-GCM before being written to the database — the API layer holds the encryption key, the database never sees plaintext credentials.

Auth is JWT-based with short-lived access tokens (15 minutes) and rotating refresh tokens stored in HttpOnly cookies. Every API endpoint requires authentication by default. The device authorization flow (RFC 8628) issues tokens to CLI tools and agents through a browser-approval step, with no special cases or backdoors in the auth stack.

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Security](docs/SECURITY-ARCHITECTURE.md)
- [Device Authorization](docs/DEVICE-AUTH.md)
- [API Reference](docs/API.md)
- [Development](docs/DEVELOPMENT.md)
- [Testing](docs/TESTING.md)
