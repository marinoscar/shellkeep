#!/usr/bin/env bash
# Builds a throw-away "slice view" of EnterpriseAppBase for platform-drift.mjs:
# each ShellKeep base module's packaged slice is copied to apps/api/src/<shellkeep-module>.
# Usage: make-slice-view.sh <EAB root> <out dir>
set -euo pipefail
E=$1; V=$2; P=$E/packages/platform-api/src
rm -rf "$V"; mkdir -p "$V/apps/api/src/common" "$V/packages/shared" "$V/apps/cli"
cp "$E/packages/shared/identity.json" "$V/packages/shared/"
cp "$E/apps/cli/package.json" "$V/apps/cli/"
for pair in auth:identity/auth users:identity/users allowlist:identity/allowlist \
  device-auth:identity/device-auth test-auth:identity/testing health:host/health \
  settings:settings storage:storage; do
  cp -r "$P/${pair#*:}" "$V/apps/api/src/${pair%%:*}"
done
# common/{filters,interceptors,middleware}: the packaged files live flat in core/errors and host/http,
# so copy each one that exists to the ShellKeep path.
for pair in filters/http-exception.filter.ts:core/errors/http-exception.filter.ts \
  interceptors/logging.interceptor.ts:host/http/logging.interceptor.ts \
  interceptors/transform.interceptor.ts:host/http/transform.interceptor.ts \
  middleware/request-id.middleware.ts:host/http/request-id.middleware.ts; do
  if [ -f "$P/${pair#*:}" ]; then
    mkdir -p "$V/apps/api/src/common/$(dirname "${pair%%:*}")"
    cp "$P/${pair#*:}" "$V/apps/api/src/common/${pair%%:*}"
  fi
done
