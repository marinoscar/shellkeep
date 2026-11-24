import type { Command } from 'commander';

import type { CommandDeps } from './deps.js';
import { CommandExit } from './exit.js';
import { writeJson } from './output.js';

// `shellkeep servers test <id>`  (issue #72)
//
// POST /api/server-profiles/:id/test opens an SSH connection from the API and
// probes the server. The response has no timing, so the latency printed is the
// round trip of that call (connect, authenticate, probe), measured here. The
// host-key status is the one the API's host-key verification (#60) reports: a
// successful test means the presented key matched the trusted one; a failure
// with HOST_KEY_UNKNOWN or HOST_KEY_MISMATCH says which. Exit 1 on any failure.

/** The API's test result. */
interface TestResponse {
  success: boolean;
  error?: string;
  code?: string;
  presented?: { fingerprint?: string; algorithm?: string } | null;
  expected?: { fingerprint?: string; algorithm?: string } | null;
}

/** The host-key states a test can report. */
export type HostKeyStatus = 'trusted' | 'unknown' | 'mismatch' | 'not-checked';

/** What `servers test` reports (and `--json` prints). */
export interface ServerTestReport {
  id: string;
  success: boolean;
  latencyMs: number;
  hostKey: { status: HostKeyStatus; presentedFingerprint: string | null };
  error: string | null;
  code: string | null;
}

/** Maps a test response to the host-key status. */
export function hostKeyStatusOf(response: TestResponse): HostKeyStatus {
  if (response.code === 'HOST_KEY_UNKNOWN') return 'unknown';
  if (response.code === 'HOST_KEY_MISMATCH') return 'mismatch';
  return response.success ? 'trusted' : 'not-checked';
}

/**
 * Tests one profile.
 *
 * @param deps - the API and output seams.
 * @param id - the server profile id.
 * @param now - the clock, for the latency.
 */
export async function testServer(deps: CommandDeps, id: string, now: () => number = () => performance.now()): Promise<ServerTestReport> {
  const started = now();
  const response = await deps.client().post<TestResponse>(`/server-profiles/${encodeURIComponent(id)}/test`);
  const latencyMs = Math.max(0, Math.round(now() - started));
  return {
    id,
    success: response.success === true,
    latencyMs,
    hostKey: {
      status: hostKeyStatusOf(response),
      presentedFingerprint: response.presented?.fingerprint ?? null,
    },
    error: response.error ?? null,
    code: response.code ?? null,
  };
}

/** Adds `test <id>` to the `servers` group. */
export function registerServersTest(group: Command, deps: CommandDeps): void {
  group
    .command('test')
    .description('Test the SSH connection of a server profile (exit 1 on failure)')
    .argument('<id>', 'server profile id')
    .option('--json', 'print JSON instead of text')
    .action(async (id: string, options: { json?: boolean }) => {
      const report = await testServer(deps, id);
      if (options.json === true) {
        writeJson(deps.stdout, report);
      } else {
        deps.stdout.write(`${report.success ? 'OK' : 'FAILED'}  latency ${report.latencyMs} ms  host key: ${report.hostKey.status}\n`);
        if (report.hostKey.presentedFingerprint !== null && report.hostKey.status !== 'trusted') {
          deps.stdout.write(`presented key: ${report.hostKey.presentedFingerprint}\n`);
        }
        if (report.error !== null) deps.stdout.write(`error: ${report.error}\n`);
      }
      if (!report.success) throw new CommandExit(`connection test failed${report.code !== null ? ` (${report.code})` : ''}`, 1);
    });
}
