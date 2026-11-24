import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetCliForTests, useTestCliIdentity } from '@marinoscar/platform-cli/testing';

import { fakeRunbookDeps, programWith } from '../__support__/fakes.js';
import { APP_CLI_OPTIONS } from '../app.js';

import { runbookCommand } from './runbook.js';

let restore: () => void;
beforeEach(() => {
  resetCliForTests();
  restore = useTestCliIdentity(APP_CLI_OPTIONS.identity, '0.1.0');
});
afterEach(() => restore());

const ITEM = {
  id: 'r1',
  name: 'Patch hosts',
  description: 'apt upgrade',
  tags: ['ops'],
  owner: { kind: 'user', name: 'Person A' },
  latestVersion: { version: 3, definition: { secret: 'leaked' } },
  updatedAt: '2026-10-01T00:00:00.000Z',
  access: { role: 'owner' },
};

describe('runbook list', () => {
  it('reads every page with the filters and prints a table', async () => {
    const harness = fakeRunbookDeps((call) => {
      const page = (call.options as { query: { page: number } }).query.page;
      return { items: [page === 1 ? ITEM : { ...ITEM, id: 'r2', name: 'Rotate logs' }], total: 2, page, pageSize: 1, totalPages: 2 };
    });
    const program = programWith((root) => runbookCommand(harness.deps)(root));

    await program.parseAsync(['runbook', 'list', '--tag', 'ops', '--search', 'p', '--filter', 'mine'], { from: 'user' });

    expect(harness.calls.map((call) => call.path)).toEqual(['/runbooks', '/runbooks']);
    expect(harness.calls[0]?.options).toMatchObject({ query: { tag: 'ops', q: 'p', filter: 'mine', page: 1, pageSize: 100 } });
    expect(harness.out()).toMatch(/Patch hosts\s+3\s+ops\s+Person A/);
    expect(harness.out()).toContain('Rotate logs');
  });

  it('--json is the projection, not the response', async () => {
    const harness = fakeRunbookDeps(() => ({ items: [ITEM], total: 1, page: 1, pageSize: 100, totalPages: 1 }));
    const program = programWith((root) => runbookCommand(harness.deps)(root));

    await program.parseAsync(['runbook', 'list', '--json'], { from: 'user' });

    expect(harness.out()).not.toContain('leaked');
    expect(JSON.parse(harness.out())).toEqual([
      { id: 'r1', name: 'Patch hosts', description: 'apt upgrade', tags: ['ops'], owner: 'Person A', version: 3, updatedAt: '2026-10-01T00:00:00.000Z' },
    ]);
  });

  it('says when there are none', async () => {
    const harness = fakeRunbookDeps(() => ({ items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 }));
    const program = programWith((root) => runbookCommand(harness.deps)(root));
    await program.parseAsync(['runbook', 'list'], { from: 'user' });
    expect(harness.out()).toBe('No runbooks.\n');
  });
});
