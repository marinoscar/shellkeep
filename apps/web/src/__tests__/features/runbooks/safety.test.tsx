/** The web side of the runbook safety API (#67): risk chips, the launcher's confirmation and dry run, the run view's badge, audit tab and command log link. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { server } from '../../mocks/server';
import { render } from '../../utils/test-utils';
import type { RunbookRisk } from '../../../features/runbooks/api/types';
import type { RunStreamOptions } from '../../../features/runbooks/api/runStream';
import { makeApproval, makeDefinition, makeDetail, makeRun, RUNBOOK_ID, RUN_ID, runbookUser } from './fixtures';

vi.mock('@xterm/xterm', async () => (await import('./xtermMock')).xtermModule);
vi.mock('@xterm/addon-search', async () => (await import('./xtermMock')).searchModule);
vi.mock('@xterm/addon-fit', async () => (await import('./xtermMock')).fitModule);
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('../../../features/runbooks/api/runStream', () => ({
  openRunStream: (_o: RunStreamOptions) => ({ close: vi.fn(), lastEventId: () => null }),
}));
const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({ ...(await vi.importActual<object>('react-router-dom')), useNavigate: () => navigate }));

import { RunLauncherDialog } from '../../../features/runbooks/components/RunLauncherDialog';
import RunDetailPage from '../../../pages/runbooks/RunDetailPage';
import RunbookDetailPage from '../../../pages/runbooks/RunbookDetailPage';

const SERVER_A = '00000000-4444-4444-8444-444444444444';
const SERVER_B = '00000001-4444-4444-8444-444444444444';
const RISK: RunbookRisk = {
  destructive: true,
  risk: 'high',
  findings: [{ stepId: 'disk', stepIndex: 0, kind: 'command', risk: 'high', destructive: true, reasons: ['unset variable expands to /'] }],
};

function serveLauncher(runs: Record<string, unknown>[], requireConfirm: boolean) {
  server.use(
    http.get(`*/api/runbooks/${RUNBOOK_ID}`, () => HttpResponse.json({ data: makeDetail({ risk: requireConfirm ? undefined : RISK }, makeDefinition()) })),
    http.get(`*/api/runbooks/${RUNBOOK_ID}/versions`, () => HttpResponse.json({ data: { items: [{ id: 'v3', version: 3, definitionSha256: 'a', changelog: null, createdBy: null, createdAt: '' }], total: 1, page: 1, pageSize: 100 } })),
    http.get('*/api/runbook-secrets', () => HttpResponse.json({ data: [] })),
    http.get('*/api/server-profiles', () => HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 100 } })),
    http.post('*/api/runbooks/targets/preview', async ({ request }) => {
      const { selector } = (await request.json()) as { selector: { serverIds: string[] } };
      const servers = selector.serverIds.map((id) => ({ id, name: id.slice(0, 8), hostname: 'h.example.test', tags: [], hostKeyTrusted: true, facts: null }));
      return HttpResponse.json({ data: { servers, skipped: [], total: servers.length, capped: false, limit: 200 } });
    }),
    http.post(`*/api/runbooks/${RUNBOOK_ID}/runs`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      runs.push(body);
      const confirm = body.confirm as { runbookName: string; targetCount: number } | undefined;
      if (!body.dryRun && (!confirm || confirm.runbookName !== 'Patch web tier' || confirm.targetCount !== 2)) {
        return HttpResponse.json(
          { code: 'RUNBOOK_CONFIRMATION_REQUIRED', message: 'Confirm', details: { runbookName: 'Patch web tier', targetCount: 2, requiresApproval: true, findings: RISK.findings } },
          { status: 428 },
        );
      }
      return HttpResponse.json({ data: { runId: 'run-7', status: 'queued', dryRun: Boolean(body.dryRun), awaitingApproval: !body.dryRun, approvalId: 'a1' } }, { status: 202 });
    }),
  );
}

const runner = runbookUser(['runbooks:read', 'runbooks:run']);

describe('launcher safety (#67)', () => {
  beforeEach(() => navigate.mockReset());

  it('gates Run on the typed name and server count, and says Request approval under the two-person rule', async () => {
    const runs: Record<string, unknown>[] = [];
    serveLauncher(runs, true);
    render(<RunLauncherDialog open runbookId={RUNBOOK_ID} initialServerIds={[SERVER_A, SERVER_B]} onClose={vi.fn()} />, { wrapperOptions: { user: runner } });
    await waitFor(() => expect(screen.getByTestId('target-count')).toHaveTextContent('2 servers'), { timeout: 5000 });
    // Not known destructive yet: the API answers 428 and the confirmation appears.
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    const section = await screen.findByTestId('destructive-confirm');
    expect(within(section).getByTestId('confirm-count')).toHaveTextContent('2 servers');
    expect(within(section).getByText(/Someone else with the approve permission/)).toBeInTheDocument();
    const request = screen.getByRole('button', { name: 'Request approval' });
    expect(request).toBeDisabled();
    await userEvent.type(within(section).getByRole('textbox', { name: 'Type the runbook name to confirm' }), 'Patch web tier');
    expect(request).toBeDisabled();
    await userEvent.type(within(section).getByRole('textbox', { name: 'Type the number to confirm' }), '3');
    expect(request).toBeDisabled();
    await userEvent.clear(within(section).getByRole('textbox', { name: 'Type the number to confirm' }));
    await userEvent.type(within(section).getByRole('textbox', { name: 'Type the number to confirm' }), '2');
    expect(request).toBeEnabled();
    await userEvent.click(request);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/runs/run-7'));
    expect(runs.at(-1)).toMatchObject({ confirm: { runbookName: 'Patch web tier', targetCount: 2 } });
  });

  it('shows the confirmation up front for a runbook the read already marks destructive', async () => {
    serveLauncher([], false);
    render(<RunLauncherDialog open runbookId={RUNBOOK_ID} initialServerIds={[SERVER_A]} onClose={vi.fn()} />, { wrapperOptions: { user: runner } });
    const section = await screen.findByTestId('destructive-confirm');
    expect(within(section).getByLabelText(/Destructive: unset variable expands to \//)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('Dry run posts dryRun without a confirmation', async () => {
    const runs: Record<string, unknown>[] = [];
    serveLauncher(runs, true);
    render(<RunLauncherDialog open runbookId={RUNBOOK_ID} initialServerIds={[SERVER_A, SERVER_B]} onClose={vi.fn()} />, { wrapperOptions: { user: runner } });
    await waitFor(() => expect(screen.getByTestId('target-count')).toHaveTextContent('2 servers'), { timeout: 5000 });
    await userEvent.click(screen.getByRole('button', { name: 'Dry run' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/runs/run-7'));
    expect(runs[0]).toMatchObject({ dryRun: true });
    expect(runs[0]).not.toHaveProperty('confirm');
  });
});

describe('run view safety (#67)', () => {
  function renderRun(run = makeRun()) {
    server.use(http.get(`*/api/runbook-runs/${RUN_ID}`, () => HttpResponse.json({ data: run })));
    return render(
      <Routes>
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>,
      { wrapperOptions: { route: `/runs/${RUN_ID}`, user: runner } },
    );
  }

  it('badges a dry run and says when a destructive run waits for a second approver', async () => {
    renderRun(makeRun(undefined, { dryRun: true, destructive: true, status: 'queued', approvals: [makeApproval({ kind: 'destructive_run' })] }));
    expect(await screen.findByTestId('dry-run-badge')).toHaveTextContent('DRY RUN');
    expect(screen.getByTestId('awaiting-approval')).toHaveTextContent(/Waiting for a second approver/);
  });

  it('links each matrix row to the command log of that server', async () => {
    const run = makeRun();
    renderRun(run);
    const link = await screen.findByRole('link', { name: 'Commands on server-000' });
    expect(link).toHaveAttribute('href', `/runs/commands?serverId=${run.targets[0]!.serverProfileId}`);
  });

  it('shows the audit trail and exports it as CSV and JSON', async () => {
    const exports: string[] = [];
    server.use(
      http.get(`*/api/runbook-runs/${RUN_ID}/audit`, () =>
        HttpResponse.json({
          data: {
            items: [
              { at: '2026-01-01T00:00:00.000Z', kind: 'event', event: 'run.created', userId: 'u', approverUserId: null, serverProfileId: null, serverName: null, stepIndex: null, stepName: null, origin: null, commandPreview: null, commandSha256: null, exitCode: null, signal: null, timedOut: null, durationMs: null, outcome: null, detail: null, dryRun: false },
              { at: '2026-01-01T00:00:01.000Z', kind: 'command', event: null, userId: 'u', approverUserId: null, serverProfileId: 's', serverName: 'server-000', stepIndex: 0, stepName: 'Check disk', origin: 'runbook', commandPreview: 'df -h', commandSha256: 'b'.repeat(64), exitCode: 0, signal: null, timedOut: false, durationMs: 120, outcome: 'succeeded', detail: null, dryRun: false },
            ],
            total: 2,
            events: 1,
            commands: 1,
            page: 1,
            pageSize: 200,
          },
        }),
      ),
      http.get(`*/api/runbook-runs/${RUN_ID}/audit/export`, ({ request }) => {
        exports.push(new URL(request.url).searchParams.get('format')!);
        return HttpResponse.text('at,kind\r\n');
      }),
    );
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderRun();
    await userEvent.click(await screen.findByRole('tab', { name: 'Audit' }));
    expect(await screen.findByText('Run created')).toBeInTheDocument();
    expect(screen.getByText('df -h')).toBeInTheDocument();
    expect(screen.getByText('1 events · 1 commands')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    await waitFor(() => expect(exports).toEqual(['csv', 'json']));
    expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });
});

describe('risk on the runbook page (#67)', () => {
  it('shows the destructive banner and a chip on the step', async () => {
    server.use(
      http.get(`*/api/runbooks/${RUNBOOK_ID}`, () => HttpResponse.json({ data: makeDetail({ risk: RISK }) })),
      http.get('*/api/runbook-runs', () => HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 5 } })),
    );
    render(
      <Routes>
        <Route path="/runbooks/:id" element={<RunbookDetailPage />} />
      </Routes>,
      { wrapperOptions: { route: `/runbooks/${RUNBOOK_ID}`, user: runner } },
    );
    expect(await screen.findByTestId('destructive-banner')).toHaveTextContent(/destructive \(step 1\)/);
    expect(screen.getByTestId('risk-chip')).toHaveTextContent('Destructive');
  });
});
