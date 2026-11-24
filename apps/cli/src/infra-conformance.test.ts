import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runInfraConformance } from '@marinoscar/platform-infra/testing';

// =============================================================================
// The platform's infra conformance, over ShellKeep (issue #73)
// =============================================================================
//
// `platform-infra sync --check` proves the generated files are the package's;
// this proves ShellKeep's own files WORK: `docker compose config` over every
// mode with the app's `infra/compose/app.*.compose.yml` overlays, and
// `nginx -t` over `infra/nginx/app.d/` with both CSP files. Docker and nginx
// are tools: when one is missing the case is a passing case NAMED with the
// reason (CI has both), so a missing tool is visible, never a silent green.
//
// Run it with `npm run test:infra`. It uses node:test (the package is ESM, so
// the API's CommonJS Jest cannot import it, and ShellKeep has no CLI workspace
// yet); #72 (the `shellkeep` CLI) may move it to `apps/cli/src/`.
// =============================================================================

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

runInfraConformance({
  appRoot: REPO,
  testApi: {
    describe: (name, body) => describe(name, body),
    it: (name, body) => it(name, async () => { await body(); }),
    expect: (actual) => ({ toEqual: (expected) => assert.deepStrictEqual(actual, expected) }),
  },
});
