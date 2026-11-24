import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { render } from '../../utils/test-utils';
import { RunLauncherDialog, launchSummary } from '../../../features/runbooks/components/RunLauncherDialog';
import type { RunbookParameter } from '../../../features/runbooks/api/types';
import { makeDefinition, makeDetail, RUNBOOK_ID, runbookUser } from './fixtures';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({ ...(await vi.importActual<object>('react-router-dom')), useNavigate: () => navigate }));

const SERVER_A = '00000000-4444-4444-8444-444444444444';
const SERVER_B = '00000001-4444-4444-8444-444444444444';

const PARAMS: RunbookParameter[] = [
  { name: 'GREETING', type: 'string', required: true, label: 'Greeting', pattern: '^[a-z]+$' },
  { name: 'COUNT', type: 'number', required: false, default: 2 },
  { name: 'DRY', type: 'boolean', required: false },
  { name: 'LEVEL', type: 'enum', required: false, options: ['low', 'high'], default: 'low' },
  { name: 'TOKEN', type: 'secret', required: true },
];

function serve(previewCalls: unknown[] = [], runs: unknown[] = []) {
  server.use(
    http.get(`*/api/runbooks/${RUNBOOK_ID}`, () => HttpResponse.json({ data: makeDetail({}, makeDefinition({ parameters: PARAMS })) })),
    http.get(`*/api/runbooks/${RUNBOOK_ID}/versions`, () =>
      HttpResponse.json({ data: { items: [{ id: 'v3', version: 3, definitionSha256: 'a', changelog: null, createdBy: null, createdAt: '2026-01-01T00:00:00.000Z' }], total: 1, page: 1, pageSize: 100 } }),
    ),
    http.get('*/api/runbook-secrets', () =>
      HttpResponse.json({ data: [{ name: 'deploy-token', label: 'Deploy token', hint: '••••ab12', createdAt: '', updatedAt: '', updatedBy: null }] }),
    ),
    http.get('*/api/server-profiles', () =>
      HttpResponse.json({
        data: {
          items: [SERVER_A, SERVER_B].map((id, i) => ({ id, name: `server-${i}`, hostname: `server-${i}.example.test`, port: 22, username: 'ops', authMethod: 'key', fingerprint: i === 0 ? 'SHA256:x' : null, tags: ['web'], color: 'default', aiOutputSharing: true, createdAt: '', updatedAt: '' })),
          total: 2,
          page: 1,
          pageSize: 100,
        },
      }),
    ),
    http.post('*/api/runbooks/targets/preview', async ({ request }) => {
      const { selector } = (await request.json()) as { selector: { serverIds: string[] } };
      previewCalls.push(selector);
      const servers = selector.serverIds.map((id, i) => ({ id, name: `server-${i}`, hostname: 'x.example.test', tags: [], hostKeyTrusted: id === SERVER_A, facts: null }));
      return HttpResponse.json({ data: { servers, skipped: [], total: servers.length, capped: false, limit: 200 } });
    }),
    http.post(`*/api/runbooks/${RUNBOOK_ID}/runs`, async ({ request }) => {
      runs.push(await request.json());
      return HttpResponse.json({ data: { runId: 'run-9' } }, { status: 202 });
    }),
  );
}

const user = runbookUser(['runbooks:read', 'runbooks:run']);

describe('RunLauncherDialog', () => {
  it('generates a field per parameter type; a secret is picked by name only', async () => {
    serve();
    render(<RunLauncherDialog open runbookId={RUNBOOK_ID} onClose={vi.fn()} />, { wrapperOptions: { user } });
    expect(await screen.findByRole('textbox', { name: 'Greeting *' })).toHaveAccessibleDescription('Must match ^[a-z]+$');
    expect(screen.getByRole('spinbutton', { name: 'COUNT' })).toHaveValue(2);
    expect(screen.getByRole('switch', { name: 'DRY' })).not.toBeChecked();
    expect(screen.getByRole('combobox', { name: 'LEVEL' })).toHaveTextContent('low');
    await userEvent.click(screen.getByRole('combobox', { name: 'TOKEN *' }));
    const option = await screen.findByRole('option', { name: 'Deploy token (deploy-token)' });
    expect(option.textContent).not.toContain('ab12');
  });

  it('updates the target count as servers are picked, flags an untrusted host key, and summarises', async () => {
    const previews: unknown[] = [];
    serve(previews);
    render(<RunLauncherDialog open runbookId={RUNBOOK_ID} initialServerIds={[SERVER_A]} onClose={vi.fn()} />, { wrapperOptions: { user } });
    const count = await screen.findByTestId('target-count');
    await waitFor(() => expect(count).toHaveTextContent('1 server'));
    expect(screen.getByTestId('launch-summary')).toHaveTextContent('1 server · up to 1 in parallel');
    const row = await screen.findByRole('row', { name: /server-1/ });
    await userEvent.click(within(row).getByRole('checkbox'));
    await waitFor(() => expect(count).toHaveTextContent('2 servers'));
    expect(count).toHaveTextContent(/Host key not trusted/);
    expect(within(count).getByRole('link', { name: 'Fix' })).toHaveAttribute('href', expect.stringContaining(SERVER_B));
    expect(screen.getByTestId('launch-summary')).toHaveTextContent('2 servers · up to 2 in parallel');
  });

  it('blocks a run with a missing required value, then posts and opens the run', async () => {
    const runs: unknown[] = [];
    serve([], runs);
    render(<RunLauncherDialog open runbookId={RUNBOOK_ID} initialServerIds={[SERVER_A]} onClose={vi.fn()} />, { wrapperOptions: { user } });
    await waitFor(() => expect(screen.getByTestId('target-count')).toHaveTextContent('1 server'));
    const run = screen.getByRole('button', { name: 'Run' });
    await userEvent.click(run);
    expect(await screen.findByText('Required')).toBeInTheDocument();
    expect(runs).toHaveLength(0);
    await userEvent.type(screen.getByRole('textbox', { name: 'Greeting *' }), 'hello');
    await userEvent.click(screen.getByRole('combobox', { name: 'TOKEN *' }));
    await userEvent.click(await screen.findByRole('option', { name: /deploy-token/ }));
    await userEvent.click(run);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/runs/run-9'));
    expect(runs[0]).toMatchObject({
      version: 3,
      params: { GREETING: 'hello', COUNT: 2, DRY: false, LEVEL: 'low' },
      secretRefs: { TOKEN: 'deploy-token' },
      targets: { serverIds: [SERVER_A] },
    });
    expect(JSON.stringify(runs[0])).not.toContain('ab12');
  });

  it('words the summary line', () => {
    expect(launchSummary(0, 5)).toBe('No servers');
    expect(launchSummary(12, 5)).toBe('12 servers · up to 5 in parallel');
  });
});
