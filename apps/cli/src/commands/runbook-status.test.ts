import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetCliForTests, useTestCliIdentity } from '@marinoscar/platform-cli/testing';

import { fakeRunbookDeps, programWith } from '../__support__/fakes.js';
import { APP_CLI_OPTIONS } from '../app.js';

import { renderRunMatrix, toRunRow } from './runbook-model.js';
import { runbookCommand } from './runbook.js';

const RUN = '44444444-4444-4444-8444-444444444444';

let restore: () => void;
beforeEach(() => {
  resetCliForTests();
  restore = useTestCliIdentity(APP_CLI_OPTIONS.identity, '0.1.0');
});
afterEach(() => restore());

const RESPONSE = {
  id: RUN,
  runbookName: 'Patch hosts',
  status: 'partially_failed',
  counts: { total: 2, succeeded: 1, failed: 1 },
  // Fields the CLI must not pass on.
  params: { TOKEN: 'leaked' },
  secretRefs: { API_KEY: 'leaked-name' },
  strategy: { concurrency: 5 },
  targets: [
    {
      id: 't1',
      serverProfileId: 's1',
      serverName: 'alpha',
      hostname: 'alpha.example.test',
      status: 'succeeded',
      steps: [
        { stepIndex: 1, name: 'restart', status: 'succeeded', exitCode: 0, durationMs: 5 },
        { stepIndex: 0, name: 'update', status: 'succeeded', exitCode: 0, durationMs: 9 },
      ],
    },
    {
      id: 't2',
      serverProfileId: 's2',
      serverName: 'beta',
      hostname: 'beta.example.test',
      status: 'failed',
      errorCode: 'STEP_FAILED',
      steps: [
        { stepIndex: 0, name: 'update', status: 'failed', exitCode: 100, durationMs: 4 },
        { stepIndex: 1, name: 'restart', status: 'skipped', exitCode: null, durationMs: null },
      ],
    },
  ],
};

describe('runbook status', () => {
  it('prints the servers x steps matrix', async () => {
    const harness = fakeRunbookDeps(() => RESPONSE);
    const program = programWith((root) => runbookCommand(harness.deps)(root));

    await program.parseAsync(['runbook', 'status', RUN], { from: 'user' });

    expect(harness.calls[0]).toMatchObject({ method: 'GET', path: `/runbook-runs/${RUN}` });
    expect(harness.out().split('\n')[0]).toBe(`run ${RUN}  partially_failed  (Patch hosts)  2 targets: 1 succeeded, 1 failed`);
    const matrix = harness.out().split('\n').slice(2, 5);
    expect(matrix[0]).toMatch(/^SERVER\s+STATUS\s+1:update\s+2:restart$/);
    expect(matrix[1]).toMatch(/^alpha\s+succeeded\s+succeeded\s+succeeded$/);
    expect(matrix[2]).toMatch(/^beta\s+failed \(STEP_FAILED\)\s+failed\s+skipped$/);
  });

  it('--json carries the projection only: no parameters, secret names or hostnames', async () => {
    const harness = fakeRunbookDeps(() => RESPONSE);
    const program = programWith((root) => runbookCommand(harness.deps)(root));

    await program.parseAsync(['runbook', 'status', RUN, '--json'], { from: 'user' });

    const text = harness.out();
    expect(text).not.toContain('leaked');
    expect(text).not.toContain('example.test');
    const parsed = JSON.parse(text) as ReturnType<typeof toRunRow>;
    expect(parsed).toMatchObject({ id: RUN, status: 'partially_failed', finished: true, succeeded: false });
    expect(parsed.targets.map((entry) => entry.steps.map((s) => s.index))).toEqual([[0, 1], [0, 1]]);
  });

  it('says so when a run has no targets yet', () => {
    expect(renderRunMatrix(toRunRow({ id: RUN, status: 'resolving' }))).toBe('(no targets yet)');
  });
});
