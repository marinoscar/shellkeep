import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeFilesForMode } from '@marinoscar/platform-infra';
import { runInfraConformance } from '@marinoscar/platform-infra/testing';
import { afterAll, describe, expect, it, vi } from 'vitest';

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

// -----------------------------------------------------------------------------
// The vps stack has no stack-agent  (issue #149)
// -----------------------------------------------------------------------------
// The generated vps.compose.yml adds `stack-agent`, built from
// apps/stack-agent/Dockerfile, which this repository does not have; the deploy
// always passes the vps files and builds, so without the overlay no install or
// update could finish. CI used to stay green because nothing built the vps stack.

const COMPOSE_DIR = join(REPO, 'infra', 'compose');

function hasComposeCli(): boolean {
  const result = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  return result.error === undefined && result.status === 0;
}

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe('the vps overlay that disables the stack agent', () => {
  it('exists, and the deploy applies it to a vps deployment and to no other mode', () => {
    expect(existsSync(join(COMPOSE_DIR, 'app.vps.no-stack-agent.compose.yml'))).toBe(true);
    const overlays = readdirSync(COMPOSE_DIR);
    const vps = composeFilesForMode('vps', { telemetry: false, overlays });
    expect(vps.filter((file) => file.startsWith('app.'))).toContain('app.vps.no-stack-agent.compose.yml');
    // Last: an overlay wins over every platform file.
    expect(vps.at(-1)?.startsWith('app.')).toBe(true);
    for (const mode of ['dev', 'prod', 'test'] as const) {
      expect(composeFilesForMode(mode, { overlays }), mode).not.toContain('app.vps.no-stack-agent.compose.yml');
    }
  });

  it.skipIf(!hasComposeCli())('leaves stack-agent out of `docker compose config` for vps, with the telemetry stack the deploy always adds', () => {
    for (const telemetry of [true]) {
      const dir = mkdtempSync(join(tmpdir(), 'shellkeep-vps-'));
      scratch.push(dir);
      cpSync(COMPOSE_DIR, dir, { recursive: true });
      writeFileSync(
        join(dir, '.env'),
        [
          'APP_URL=https://app.example.test',
          'POSTGRES_HOST=db.internal',
          'POSTGRES_USER=shellkeep_app',
          'POSTGRES_PASSWORD=secret',
          'POSTGRES_DB=shellkeep',
          'JWT_SECRET=0123456789abcdef0123456789abcdef',
          'COOKIE_SECRET=fedcba9876543210fedcba9876543210',
          'COMPOSE_PROJECT_NAME=shellkeep',
          'DEPLOY_ROOT=/opt/infra/apps/shellkeep',
          `STACK_AGENT_TOKEN=${'a1'.repeat(32)}`,
          'GREPTIME_ADMIN_PASSWORD=conformance-admin',
          'GREPTIME_WRITER_PASSWORD=conformance-writer',
          'GREPTIME_READER_PASSWORD=conformance-reader',
          '',
        ].join('\n'),
      );
      const files = composeFilesForMode('vps', { telemetry, overlays: readdirSync(dir) });
      const args = ['compose', ...files.flatMap((file) => ['-f', file]), 'config', '--format', 'json'];
      // No inherited environment: a variable exported in the developer's shell must not complete the .env.
      const result = spawnSync('docker', args, {
        cwd: dir,
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? tmpdir() },
      });
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
      const services = Object.keys((JSON.parse(result.stdout) as { services: Record<string, unknown> }).services);
      expect(services, `telemetry=${telemetry}`).not.toContain('stack-agent');
      expect(services).toEqual(expect.arrayContaining(['api', 'web']));
    }
  });
});
