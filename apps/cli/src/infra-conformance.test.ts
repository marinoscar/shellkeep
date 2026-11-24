import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runInfraConformance } from '@marinoscar/platform-infra/testing';
import { describe, expect, it, vi } from 'vitest';

// =============================================================================
// The platform's infra conformance, over ShellKeep  (issues #73, #72)
// =============================================================================
//
// `platform-infra sync --check` proves the generated files are the package's;
// this proves ShellKeep's own files WORK: `docker compose config` over every
// mode with the app's `infra/compose/app.*.compose.yml` overlays, and
// `nginx -t` over `infra/nginx/app.d/` with both CSP files. Docker and nginx
// are tools: when one is missing the case is a passing case NAMED with the
// reason (CI has both), so a missing tool is visible, never a silent green.
//
// It lives in the CLI workspace (vitest, ESM) because the API's Jest is
// CommonJS and cannot import the package. Run it alone with
// `npm run test:infra`. Each case shells out to docker, which is slower than a
// unit test, so the timeout is raised for this file only.
// =============================================================================

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

runInfraConformance({ appRoot: REPO, testApi: { describe, it, expect } });
