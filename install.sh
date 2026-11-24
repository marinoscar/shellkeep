#!/usr/bin/env bash
# install.sh — shellkeep CLI installer / updater  (issue #72)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/marinoscar/shellkeep/main/install.sh | bash
#   # or, locally:
#   bash install.sh
#   bash install.sh --uninstall
#   bash install.sh --help
#
# Configuration (set via environment variables before running):
#   SHELLKEEP_REPO     Git repo URL (default: https://github.com/marinoscar/shellkeep.git)
#   SHELLKEEP_REF      Branch/tag/commit to install (default: main)
#   SHELLKEEP_HOME     App install root (default: $HOME/.shellkeep — the same directory
#                 the CLI itself already stores config.json in, the config directory derives from the CLI name)
#   SHELLKEEP_BIN_DIR  Directory for the `shellkeep` shim (default: $HOME/.local/bin)
#   GITHUB_TOKEN  Optional GitHub PAT for private-repo clones
#   SHELLKEEP_SRC      Optional: local directory to install from (skips git clone).
#                 Useful for offline installs and local testing:
#                   SHELLKEEP_SRC=/path/to/repo bash install.sh
#
# NOTE: The public `curl | bash` flow requires the repository to be public (or
# GITHUB_TOKEN set for private repos). The SHELLKEEP_SRC path lets you verify
# installer logic locally without any network access.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# ANSI color helpers (honor NO_COLOR)
# ---------------------------------------------------------------------------
_use_color() {
  [[ -z "${NO_COLOR:-}" ]] && [[ -t 1 ]]
}

_c() {
  # _c <code> <text>
  if _use_color; then
    printf '\033[%sm%s\033[0m' "$1" "$2"
  else
    printf '%s' "$2"
  fi
}

GREEN=32; CYAN=36; YELLOW=33; RED=31; BOLD=1; DIM=2

ok()   { printf '%s %s\n'  "$(_c $GREEN  "✔")" "$1"; }
err()  { printf '%s %s\n'  "$(_c $RED    "✖")" "$1" >&2; }
warn() { printf '%s %s\n'  "$(_c $YELLOW "⚠")" "$1"; }
info() { printf '%s %s\n'  "$(_c $CYAN   "ℹ")" "$1"; }
step() { printf '\n%s %s\n' "$(_c $BOLD  "→")" "$(_c $BOLD "$1")"; }
dim()  { printf '  %s\n'   "$(_c $DIM   "$1")"; }

# ---------------------------------------------------------------------------
# Box printer (ANSI, no external deps)
# ---------------------------------------------------------------------------
print_box() {
  local title="${1:-}"
  shift
  local lines=("$@")
  local width=60
  local pad="  "

  local border_h
  border_h=$(printf '─%.0s' $(seq 1 $width))

  if _use_color; then
    printf '\033[36m╭%s╮\033[0m\n' "$border_h"
    if [[ -n "$title" ]]; then
      local tpad=$(( (width - ${#title} - 2) / 2 ))
      printf '\033[36m│\033[0m%*s\033[1m%s\033[0m%*s\033[36m│\033[0m\n' \
        "$tpad" "" "$title" "$tpad" ""
      printf '\033[36m├%s┤\033[0m\n' "$border_h"
    fi
    for line in "${lines[@]}"; do
      printf '\033[36m│\033[0m %s%-*s \033[36m│\033[0m\n' \
        "${pad}" "$((width - ${#pad} - 1))" "$line"
    done
    printf '\033[36m╰%s╯\033[0m\n' "$border_h"
  else
    printf '+%s+\n' "$(printf -- '-%.0s' $(seq 1 $width))"
    if [[ -n "$title" ]]; then
      printf '| %-*s |\n' "$((width - 1))" "$title"
      printf '+%s+\n' "$(printf -- '-%.0s' $(seq 1 $width))"
    fi
    for line in "${lines[@]}"; do
      printf '| %-*s |\n' "$((width - 1))" "${pad}${line}"
    done
    printf '+%s+\n' "$(printf -- '-%.0s' $(seq 1 $width))"
  fi
}

# ---------------------------------------------------------------------------
# Environment detection helpers
# ---------------------------------------------------------------------------
# Detect Windows Subsystem for Linux (WSL 1 or 2). WSL exports WSL_DISTRO_NAME
# and the kernel release / /proc/version advertise "microsoft" or "WSL".
is_wsl() {
  [[ -n "${WSL_DISTRO_NAME:-}" ]] && return 0
  grep -qiE '(microsoft|wsl)' /proc/version 2>/dev/null && return 0
  uname -r 2>/dev/null | grep -qiE '(microsoft|wsl)' && return 0
  return 1
}

# Best-effort guess at the interactive shell's rc file so PATH guidance points
# at the right place. Defaults to ~/.bashrc (the WSL default shell).
detect_shell_rc() {
  case "${SHELL:-}" in
    */zsh) printf '%s' "$HOME/.zshrc" ;;
    *)     printf '%s' "$HOME/.bashrc" ;;
  esac
}

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
SHELLKEEP_REPO="${SHELLKEEP_REPO:-https://github.com/marinoscar/shellkeep.git}"
SHELLKEEP_REF="${SHELLKEEP_REF:-main}"

# ---------------------------------------------------------------------------
# Where the install lands, and why root gets a different answer
# ---------------------------------------------------------------------------
# `sudo` does not carry the invoking user's PATH. It replaces it with
# `secure_path` from /etc/sudoers, which never contains anyone's
# $HOME/.local/bin — so a shim installed under a home directory is invisible
# to `sudo shellkeep`, while every `shellkeep deploy` command in apps/cli/README.md
# is written for a root shell. That combination produced `sudo: shellkeep: command
# not found` in the middle of a deploy, which reads like a broken install.
#
# Installing AS root therefore defaults to the system locations: the shim to
# /usr/local/bin (on secure_path on Debian and Ubuntu) and the app tree to
# /usr/local/lib/shellkeep, which is world-readable — so ONE install serves `shellkeep`
# and `sudo shellkeep` alike. Keeping the app under /root/.shellkeep would only move the
# failure rather than fix it: reachable by root, permission-denied for every
# other user on the box.
#
# This moves no credentials. The CLI derives its own config directory at
# runtime from the RUNNING user's home — `configDirPath()` in
# apps/cli/src/config.ts joins `os.homedir()` with CONFIG_DIR_NAME — so tokens
# stay per-user no matter where the code was unpacked. SHELLKEEP_HOME decides where
# the CODE lives, nothing else.
#
# An explicit SHELLKEEP_HOME / SHELLKEEP_BIN_DIR still wins over both branches, so
# apps/cli/bootstrap-vps.sh (which sets SHELLKEEP_BIN_DIR=/usr/local/bin) is unaffected.
if [[ "$(id -u)" -eq 0 ]]; then
  SHELLKEEP_HOME="${SHELLKEEP_HOME:-/usr/local/lib/shellkeep}"
  SHELLKEEP_BIN_DIR="${SHELLKEEP_BIN_DIR:-/usr/local/bin}"
else
  SHELLKEEP_HOME="${SHELLKEEP_HOME:-$HOME/.shellkeep}"
  SHELLKEEP_BIN_DIR="${SHELLKEEP_BIN_DIR:-$HOME/.local/bin}"
fi

SHELLKEEP_SRC="${SHELLKEEP_SRC:-}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

CLI_DIR="$SHELLKEEP_HOME/cli"
BIN_SHIM="$SHELLKEEP_BIN_DIR/shellkeep"

# ---------------------------------------------------------------------------
# Read the "version" field from a package.json using node (a hard dependency).
# Falls back to a grep/sed parse if node is unavailable for any reason.
# ---------------------------------------------------------------------------
read_pkg_version() {
  local pkg_file="$1"
  [[ -f "$pkg_file" ]] || { printf 'unknown'; return; }
  if command -v node &>/dev/null; then
    node -p "require('$pkg_file').version" 2>/dev/null && return
  fi
  grep -m1 '"version"' "$pkg_file" 2>/dev/null \
    | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
    || printf 'unknown'
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
ACTION="install"
for arg in "$@"; do
  case "$arg" in
    --uninstall) ACTION="uninstall" ;;
    --help|-h)   ACTION="help" ;;
    --no-color)  export NO_COLOR=1 ;;
    *) warn "Unknown argument: $arg" ;;
  esac
done

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
show_help() {
  cat <<EOF

$(_c $BOLD "shellkeep CLI Installer")

USAGE
  bash install.sh [options]

OPTIONS
  (none)        Install or update the CLI
  --uninstall   Remove the CLI and its shim
  --help        Show this message
  --no-color    Disable ANSI colors

ENVIRONMENT VARIABLES
  SHELLKEEP_REPO     Git clone URL  (default: $SHELLKEEP_REPO)
  SHELLKEEP_REF      Branch/tag     (default: $SHELLKEEP_REF)
  SHELLKEEP_HOME     Install root   (default: \$HOME/.shellkeep)
  SHELLKEEP_BIN_DIR  Shim directory (default: \$HOME/.local/bin)
  GITHUB_TOKEN  GitHub PAT for private repos (optional)
  SHELLKEEP_SRC      Local source directory — skip git clone (optional)
                Example: SHELLKEEP_SRC=/path/to/repo bash install.sh

NOTE
  The public curl | bash flow requires the repo to be public (or GITHUB_TOKEN
  set). Use SHELLKEEP_SRC for offline / local testing.

EOF
}

if [[ "$ACTION" == "help" ]]; then
  show_help
  exit 0
fi

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------
do_uninstall() {
  step "Uninstalling shellkeep CLI"

  if [[ -d "$CLI_DIR" ]]; then
    rm -rf "$CLI_DIR"
    ok "Removed CLI directory: $CLI_DIR"
  else
    warn "CLI directory not found: $CLI_DIR"
  fi

  if [[ -f "$BIN_SHIM" ]]; then
    rm -f "$BIN_SHIM"
    ok "Removed shim: $BIN_SHIM"
  else
    warn "Shim not found: $BIN_SHIM"
  fi

  # $SHELLKEEP_HOME itself is NEVER removed: for a user install it is the
  # directory the CLI keeps config.json in (`~/.shellkeep`), so `rm -rf
  # "$SHELLKEEP_HOME"` would destroy the user's stored token. Only
  # $SHELLKEEP_HOME/cli goes.
  info "Config and credentials in ~/.shellkeep/config.json (if any) are left in place."
  ok "shellkeep CLI uninstalled."
}

if [[ "$ACTION" == "uninstall" ]]; then
  do_uninstall
  exit 0
fi

# ---------------------------------------------------------------------------
# Install / update
# ---------------------------------------------------------------------------

# Print header
printf '\n'
if _use_color; then
  printf '\033[36m  shellkeep CLI Installer\033[0m\n'
else
  printf '  shellkeep CLI Installer\n'
fi
printf '\n'

# Detect update vs fresh install, and capture the currently-installed version
# (if any) so we can show an old → new transition at the end.
PREV_VERSION=""
if [[ -d "$CLI_DIR" ]]; then
  PREV_VERSION="$(read_pkg_version "$CLI_DIR/package.json")"
  info "Updating existing installation at $CLI_DIR"
  [[ -n "$PREV_VERSION" && "$PREV_VERSION" != "unknown" ]] && dim "Currently installed: v$PREV_VERSION"
else
  info "Installing shellkeep CLI to $CLI_DIR"
fi

# ---------------------------------------------------------------------------
# Step 1: Dependency checks
# ---------------------------------------------------------------------------
step "Checking dependencies"

UNAME_S="$(uname -s 2>/dev/null || echo unknown)"
UNAME_M="$(uname -m 2>/dev/null || echo unknown)"
info "Platform  $(_c $DIM "${UNAME_S} ${UNAME_M}")"

check_tool() {
  local name="$1"
  local min_major="${2:-0}"
  if ! command -v "$name" &>/dev/null; then
    err "$name is required but not found."
    case "$name" in
      node) warn "Install Node.js >= 20 from https://nodejs.org or via nvm: https://github.com/nvm-sh/nvm" ;;
      npm)  warn "npm ships with Node.js; reinstall from https://nodejs.org" ;;
      git)  warn "Install git from https://git-scm.com" ;;
      curl) warn "Install curl via your package manager (e.g. apt install curl)" ;;
    esac
    exit 1
  fi

  local version
  version="$("$name" --version 2>&1 | head -1)"

  # Node.js version gate — 20 is apps/cli's own engines.node floor. (The repo
  # root's package.json asks for >=24 for the full monorepo dev toolchain,
  # but building just the cli workspace only needs what its own package.json
  # requires.)
  if [[ "$name" == "node" && "$min_major" -gt 0 ]]; then
    local major
    major=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))" 2>/dev/null || echo "0")
    if [[ "$major" -lt "$min_major" ]]; then
      err "Node.js >= ${min_major} is required (found: $version)"
      warn "Upgrade via nvm: nvm install --lts"
      exit 1
    fi
  fi

  ok "$name  $(_c $DIM "$version")"
}

check_tool node 20
check_tool npm
check_tool git
check_tool curl

# Warn (don't fail) if the install target looks low on free space. shellkeep has
# no native modules, so the footprint is small — a few tens of MB for
# commander/ink/react and their transitive deps.
if command -v df &>/dev/null; then
  avail_kb="$(df -Pk "$SHELLKEEP_HOME" 2>/dev/null || df -Pk "$HOME" 2>/dev/null)"
  avail_kb="$(printf '%s\n' "$avail_kb" | awk 'NR==2 {print $4}')"
  if [[ -n "${avail_kb:-}" && "$avail_kb" =~ ^[0-9]+$ ]]; then
    if (( avail_kb < 51200 )); then
      warn "Low disk space at install target ($(( avail_kb / 1024 )) MB free; ~50 MB needed)"
    else
      ok "Disk space  $(_c $DIM "$(( avail_kb / 1024 )) MB free")"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Step 2: Get source (clone or use local)
# ---------------------------------------------------------------------------
step "Preparing source"

TMP_DIR=""
cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
    dim "Cleaned up temp dir: $TMP_DIR"
  fi
}
trap cleanup EXIT

if [[ -n "$SHELLKEEP_SRC" ]]; then
  if [[ ! -d "$SHELLKEEP_SRC" ]]; then
    err "SHELLKEEP_SRC directory not found: $SHELLKEEP_SRC"
    exit 1
  fi
  info "Using local source: $SHELLKEEP_SRC"
  # Copy to a temp dir so we don't pollute the working tree
  TMP_DIR="$(mktemp -d)"
  cp -r "$SHELLKEEP_SRC/." "$TMP_DIR/"
  ok "Copied source to temp dir"
else
  TMP_DIR="$(mktemp -d)"
  local_repo="$SHELLKEEP_REPO"

  # Inject GitHub token for private-repo support
  if [[ -n "$GITHUB_TOKEN" ]]; then
    # Replace https://github.com/ with https://<token>@github.com/
    local_repo="${SHELLKEEP_REPO/https:\/\/github.com\//https:\/\/$GITHUB_TOKEN@github.com\/}"
    info "Using GITHUB_TOKEN for authentication"
  fi

  info "Cloning $SHELLKEEP_REPO @ $SHELLKEEP_REF …"
  git clone --depth 1 --branch "$SHELLKEEP_REF" "$local_repo" "$TMP_DIR" 2>&1 \
    | grep -v "^$" | while IFS= read -r line; do dim "$line"; done || {
    err "Git clone failed. If the repo is private, set GITHUB_TOKEN or use SHELLKEEP_SRC."
    exit 1
  }
  ok "Cloned repository"
fi

# ---------------------------------------------------------------------------
# Announce the version we are about to install (read from the source manifest),
# and classify the transition relative to any currently-installed version.
# ---------------------------------------------------------------------------
SRC_VERSION="$(read_pkg_version "$TMP_DIR/apps/cli/package.json")"
if [[ -n "$SRC_VERSION" && "$SRC_VERSION" != "unknown" ]]; then
  if [[ -z "$PREV_VERSION" || "$PREV_VERSION" == "unknown" ]]; then
    ok "Installing shellkeep CLI $(_c $BOLD "v$SRC_VERSION")"
  elif [[ "$PREV_VERSION" == "$SRC_VERSION" ]]; then
    ok "Reinstalling shellkeep CLI $(_c $BOLD "v$SRC_VERSION") (same version)"
  else
    ok "Updating shellkeep CLI $(_c $BOLD "v$PREV_VERSION") → $(_c $BOLD "v$SRC_VERSION")"
  fi
else
  warn "Could not determine the version from the source manifest"
fi

# ---------------------------------------------------------------------------
# Step 3: Build the CLI workspace
# ---------------------------------------------------------------------------
step "Building CLI"

info "Installing CLI workspace dependencies …"
# --workspace=apps/cli installs only the cli workspace's deps (plus what npm needs
# at the root to resolve the workspace), without triggering api/web installs.
(
  cd "$TMP_DIR"
  npm install --workspace=apps/cli --no-audit --no-fund 2>&1 \
    | grep -v "^$" \
    | grep -v "^npm warn deprecated" \
    | grep -v "^npm warn EBADENGINE" \
    | grep -v "^npm warn" \
    | while IFS= read -r line; do dim "$line"; done
) || {
  err "npm install failed"
  exit 1
}
ok "Dependencies installed"

info "Compiling TypeScript …"
(
  cd "$TMP_DIR"
  npm run build --workspace=apps/cli 2>&1 \
    | grep -v "^$" | while IFS= read -r line; do dim "$line"; done
) || {
  err "Build failed"
  exit 1
}
ok "Build complete"

# ---------------------------------------------------------------------------
# Step 4: Deploy standalone app
# ---------------------------------------------------------------------------
step "Deploying standalone app"

# Remove old install
if [[ -d "$CLI_DIR" ]]; then
  rm -rf "$CLI_DIR"
fi
mkdir -p "$CLI_DIR"

# Copy the built artifacts, the package manifest and the environment
# template - not the full repo.
# Most of apps/cli's runtime deps (@marinoscar/platform-cli, which brings
# commander and ink, and react) are ordinary public npm packages. @shellkeep/shared
# is not: it is an internal workspace package
# that is `private: true` and never published, so the `npm install`
# below — which runs OUTSIDE the monorepo, with no workspace to link against —
# would go looking for it on the public registry and fail the whole install.
#
# So vendor it next to the app and rewrite the dependency to a `file:`
# specifier npm can resolve locally. The whole packages/ tree is copied rather
# than the one directory by name, so adding a second shared package later
# cannot silently reintroduce this failure.
cp -r "$TMP_DIR/apps/cli/dist"        "$CLI_DIR/dist"
cp    "$TMP_DIR/apps/cli/package.json" "$CLI_DIR/package.json"
if [[ -f "$TMP_DIR/apps/cli/README.md" ]]; then
  cp "$TMP_DIR/apps/cli/README.md" "$CLI_DIR/README.md"
fi

# The repository's environment template, kept beside the CLI.
#
# Older engines read this copy before cloning anything, so a first install on
# a root shell with a logged-out `gh` still knew its questions. The engine this
# repository pins (@marinoscar/platform-cli 0.1.0-next.39) no longer does: the
# wizard reads the generated .env.example of the repository it clones. The copy
# is kept because it is one small file and harmless; the test in
# apps/cli/src/install-sh.test.ts pins what this block writes and that the
# pinned engine has no reader of it.
#
# source.json records WHICH repository it came from, so a reader can refuse the
# copy for any other one.
TEMPLATE_SRC="$TMP_DIR/infra/compose/.env.example"
if [[ -f "$TEMPLATE_SRC" ]]; then
  # The URL git itself would push to, so a local-source install records the
  # real repository rather than the temp directory it was copied through.
  SRC_REPO_URL="$(git -C "$TMP_DIR" remote get-url origin 2>/dev/null || true)"
  [[ -n "$SRC_REPO_URL" ]] || SRC_REPO_URL="$SHELLKEEP_REPO"
  if [[ -n "$SHELLKEEP_SRC" ]]; then
    SRC_REF="$(git -C "$TMP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    [[ "$SRC_REF" != "HEAD" ]] || SRC_REF=""
  else
    SRC_REF="$SHELLKEEP_REF"
  fi

  mkdir -p "$CLI_DIR/template"
  cp "$TEMPLATE_SRC" "$CLI_DIR/template/.env.example"
  # Written by node rather than a printf so the URL and ref are JSON-escaped
  # by something that knows the rules, not by hand.
  node -e '
    const fs = require("node:fs");
    fs.writeFileSync(
      process.argv[1],
      JSON.stringify({ repoUrl: process.argv[2], ref: process.argv[3] }, null, 2) + "\n",
    );
  ' "$CLI_DIR/template/source.json" "$SRC_REPO_URL" "$SRC_REF" || {
    err "Failed to record the bundled template source"
    exit 1
  }
  ok "Bundled the environment template from $SRC_REPO_URL"
else
  warn "No infra/compose/.env.example in the source; the wizard will read it from the remote"
fi

if [[ -d "$TMP_DIR/packages" ]]; then
  info "Vendoring internal workspace packages …"
  mkdir -p "$CLI_DIR/vendor"
  cp -r "$TMP_DIR/packages/." "$CLI_DIR/vendor/"
  node -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const manifest = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const vendor = path.join(path.dirname(manifest), "vendor");
    let count = 0;
    for (const field of ["dependencies", "optionalDependencies"]) {
      for (const name of Object.keys(pkg[field] || {})) {
        if (!name.startsWith("@shellkeep/")) continue;
        const dir = name.slice("@shellkeep/".length);
        if (!fs.existsSync(path.join(vendor, dir))) {
          console.error("no vendored copy of " + name + " at vendor/" + dir);
          process.exit(1);
        }
        pkg[field][name] = "file:./vendor/" + dir;
        count++;
      }
    }
    fs.writeFileSync(manifest, JSON.stringify(pkg, null, 2) + "\n");
    console.log("rewrote " + count + " workspace dependency specifier(s)");
  ' "$CLI_DIR/package.json" || {
    err "Failed to vendor internal workspace packages"
    exit 1
  }
fi

ok "Copied dist + package.json to $CLI_DIR"

info "Installing runtime dependencies (omitting devDeps) …"
# This runs OUTSIDE the monorepo, so npm installs only the CLI's own runtime
# deps (@marinoscar/platform-cli with its own dependencies, and react).
(
  cd "$CLI_DIR"
  npm install --omit=dev --no-audit --no-fund 2>&1 \
    | grep -v "^$" \
    | grep -v "^npm warn" \
    | while IFS= read -r line; do dim "$line"; done
) || {
  err "Runtime npm install failed"
  exit 1
}
ok "Runtime dependencies installed"

# ---------------------------------------------------------------------------
# Step 5: Write bin shim
# ---------------------------------------------------------------------------
step "Installing CLI shim"

mkdir -p "$SHELLKEEP_BIN_DIR"

# apps/cli's package.json points bin at ./dist/cli.js directly (it already
# carries a shebang and is chmod'd 0755 by the build's postbuild step) — there
# is no separate dist/index.js entrypoint to exec here.
cat > "$BIN_SHIM" <<SHIM
#!/usr/bin/env bash
exec node "$CLI_DIR/dist/cli.js" "\$@"
SHIM

chmod +x "$BIN_SHIM"
ok "Shim written: $BIN_SHIM"

# ---------------------------------------------------------------------------
# Step 6: PATH check
# ---------------------------------------------------------------------------
BIN_ON_PATH=0
if echo ":$PATH:" | grep -q ":$SHELLKEEP_BIN_DIR:"; then
  BIN_ON_PATH=1
fi

# Plain PATH guidance for non-WSL shells. WSL users get a dedicated, nicer
# call-out box printed after the completion summary (see below), so we skip
# this generic block for them to avoid duplicate messaging.
if [[ "$BIN_ON_PATH" != "1" ]] && ! is_wsl; then
  warn "$SHELLKEEP_BIN_DIR is not on your PATH"
  printf '\n'
  info "Add the following line to your shell config (~/.bashrc or ~/.zshrc):"
  printf '\n'
  printf '    %s\n' "export PATH=\"\$PATH:$SHELLKEEP_BIN_DIR\""
  printf '\n'
  info "Then reload: source ~/.bashrc  (or source ~/.zshrc)"
  printf '\n'
fi

# A user-scope install is invisible to `sudo`, which replaces PATH with
# secure_path from /etc/sudoers — a list that never contains a home directory.
# Say so HERE rather than letting it surface later as `sudo: shellkeep: command not
# found` partway through a deploy, where it reads like a broken install.
# Only worth saying when there is a sudo to be confused by.
if [[ "$(id -u)" -ne 0 && "$SHELLKEEP_BIN_DIR" == "$HOME"/* ]] && command -v sudo >/dev/null 2>&1; then
  warn "Installed for this user only — \`sudo shellkeep\` will NOT find it"
  printf '\n'
  info "sudo replaces PATH with secure_path from /etc/sudoers, which never"
  info "contains a home directory. This matters on a server: every"
  info "\`shellkeep deploy\` command in apps/cli/README.md assumes a root shell."
  printf '\n'
  info "To install system-wide as well (shim in /usr/local/bin):"
  printf '\n'
  if [[ -n "$SHELLKEEP_SRC" ]]; then
    printf '    %s\n' "sudo SHELLKEEP_SRC=\"$SHELLKEEP_SRC\" bash install.sh"
  else
    printf '    %s\n' "sudo bash install.sh"
  fi
  printf '\n'
fi

# ---------------------------------------------------------------------------
# Step 7: Print installed version
# ---------------------------------------------------------------------------
step "Verifying installation"

# `--version` prints "<cli version> (platform <engine version>)" since the CLI
# is built on the platform engine; the first word is the version this
# installer built and compares against.
INSTALLED_VERSION="$("$BIN_SHIM" --version 2>/dev/null | head -1 | awk '{print $1}' || echo "unknown")"
if [[ "$INSTALLED_VERSION" == "unknown" || -z "$INSTALLED_VERSION" ]]; then
  err "Installed binary did not report a version — the install may be broken."
  dim "  Try running: $BIN_SHIM --version"
  exit 1
fi
ok "Installed version: $(_c $BOLD "v$INSTALLED_VERSION")"

# Sanity check: the running binary should report the version we just built.
if [[ -n "$SRC_VERSION" && "$SRC_VERSION" != "unknown" && "$INSTALLED_VERSION" != "$SRC_VERSION" ]]; then
  warn "Version mismatch: expected v$SRC_VERSION from source but binary reports v$INSTALLED_VERSION"
fi

INSTALL_SIZE="unknown"
if command -v du &>/dev/null; then
  INSTALL_SIZE="$(du -sh "$CLI_DIR" 2>/dev/null | cut -f1)"
fi
ok "Install size: $INSTALL_SIZE"

VERSION_LINE="CLI version : v$INSTALLED_VERSION"
if [[ -n "$PREV_VERSION" && "$PREV_VERSION" != "unknown" && "$PREV_VERSION" != "$INSTALLED_VERSION" ]]; then
  VERSION_LINE="CLI version : v$PREV_VERSION -> v$INSTALLED_VERSION"
fi

print_box "Installation Complete" \
  "$VERSION_LINE" \
  "Install size: $INSTALL_SIZE" \
  "Location    : $CLI_DIR" \
  "Shim        : $BIN_SHIM" \
  "" \
  "Get started:" \
  "  shellkeep login" \
  "  shellkeep servers list" \
  "  shellkeep --help"

# ---------------------------------------------------------------------------
# Step 8: Windows / WSL PATH call-out
# ---------------------------------------------------------------------------
# On Windows 11 + WSL the default shell rarely has ~/.local/bin on PATH, so the
# freshly-installed `shellkeep` command is "not found" until the user appends it.
# Print an explicit, copy-pasteable box with the exact two commands.
if is_wsl && [[ "$BIN_ON_PATH" != "1" ]]; then
  RC_FILE="$(detect_shell_rc)"
  RC_SHORT="${RC_FILE/#"$HOME"/\~}"
  printf '\n'
  print_box "Windows 11 · WSL — one more step" \
    "Detected Windows Subsystem for Linux (WSL)." \
    "" \
    "The 'shellkeep' command was installed to:" \
    "$SHELLKEEP_BIN_DIR" \
    "but that directory is not on your PATH yet, so" \
    "your shell reports 'command not found'." \
    "" \
    "Run these two commands to finish setup:" \
    "" \
    "echo 'export PATH=\"\$PATH:$SHELLKEEP_BIN_DIR\"' >> $RC_SHORT" \
    "source $RC_SHORT" \
    "" \
    "Then verify it works:" \
    "shellkeep --version"
  printf '\n'
fi
