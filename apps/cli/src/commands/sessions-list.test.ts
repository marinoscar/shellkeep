import { describe, expect, it } from 'vitest';

import { fakeDeps, programWith } from '../__support__/fakes.js';

import { listSessions, toSessionRow } from './sessions-list.js';
import { sessionsCommand } from './sessions.js';

const SESSION = {
  id: '5a1e6c0e-6b0e-4d52-9d6e-1f5d0f6f3a11',
  userId: '22222222-2222-4222-8222-222222222222',
  orgId: '44444444-4444-4444-8444-444444444444',
  serverProfileId: '11111111-1111-4111-8111-111111111111',
  name: 'deploy shell',
  status: 'active',
  tmuxSessionId: 'sk-internal-name',
  cols: 120,
  rows: 40,
  lastActivityAt: '2026-11-01T10:00:00.000Z',
  createdAt: '2026-11-01T09:00:00.000Z',
  serverProfile: { name: 'Staging web', hostname: 'web.example.test', port: 22, username: 'deploy', color: 'info' },
};

describe('sessions list', () => {
  it('projects a session and leaves the tmux name out', () => {
    const row = toSessionRow(SESSION);
    expect(row).toMatchObject({ id: SESSION.id, name: 'deploy shell', status: 'active', server: { name: 'Staging web' } });
    expect(JSON.stringify(row)).not.toContain('sk-internal-name');
    expect(JSON.stringify(row)).not.toContain('color');
  });

  it('passes --status to GET /sessions and reads every page', async () => {
    const { deps, calls } = fakeDeps((call) => {
      const page = (call.options as { query: { page: number } }).query.page;
      return { items: [{ ...SESSION, id: `s${page}` }], total: 2, page, pageSize: 1, totalPages: 2 };
    });

    const rows = await listSessions(deps, 'active');

    expect(rows.map((row) => row.id)).toEqual(['s1', 's2']);
    expect(calls.map((call) => (call.options as { query: Record<string, unknown> }).query)).toEqual([
      { status: 'active', page: 1, pageSize: 100 },
      { status: 'active', page: 2, pageSize: 100 },
    ]);
  });

  it('sends no status filter by default', async () => {
    const { deps, calls } = fakeDeps(() => ({ items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 }));
    await listSessions(deps, undefined);
    expect((calls[0]?.options as { query: Record<string, unknown> }).query).toEqual({ page: 1, pageSize: 100 });
  });

  it('prints a table, or JSON with --json', async () => {
    const text = fakeDeps(() => ({ items: [SESSION], total: 1, page: 1, pageSize: 100, totalPages: 1 }));
    await programWith((root) => sessionsCommand(text.deps)(root)).parseAsync(['sessions', 'list'], { from: 'user' });
    expect(text.out()).toContain('deploy shell');
    expect(text.out()).toContain('Staging web');

    const json = fakeDeps(() => ({ items: [SESSION], total: 1, page: 1, pageSize: 100, totalPages: 1 }));
    await programWith((root) => sessionsCommand(json.deps)(root)).parseAsync(['sessions', 'list', '--json'], { from: 'user' });
    expect(JSON.parse(json.out())).toHaveLength(1);
  });

  it('rejects an unknown --status as a usage error before calling the API', async () => {
    const { deps, calls } = fakeDeps(() => ({}));
    const program = programWith((root) => sessionsCommand(deps)(root));

    const failure = await program.parseAsync(['sessions', 'list', '--status', 'sleeping'], { from: 'user' }).catch((error: unknown) => error);

    expect((failure as { exitCode: number }).exitCode).toBe(2);
    expect(calls).toEqual([]);
  });
});
