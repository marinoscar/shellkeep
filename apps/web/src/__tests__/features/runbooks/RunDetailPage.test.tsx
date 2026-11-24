import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { axe } from 'vitest-axe';
import { Route, Routes } from 'react-router-dom';
import { server } from '../../mocks/server';
import { render } from '../../utils/test-utils';
import type { RunStreamOptions } from '../../../features/runbooks/api/runStream';
import { makeRun, makeStep, makeTarget, RUN_ID, runbookUser } from './fixtures';

vi.mock('@xterm/xterm', async () => (await import('./xtermMock')).xtermModule);
vi.mock('@xterm/addon-search', async () => (await import('./xtermMock')).searchModule);
vi.mock('@xterm/addon-fit', async () => (await import('./xtermMock')).fitModule);
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

const { streams } = vi.hoisted(() => ({ streams: [] as RunStreamOptions[] }));
vi.mock('../../../features/runbooks/api/runStream', () => ({
  openRunStream: (options: RunStreamOptions) => {
    streams.push(options);
    return { close: vi.fn(), lastEventId: () => null };
  },
}));

import RunDetailPage from '../../../pages/runbooks/RunDetailPage';
import { terminals } from './xtermMock';

function serveRun(run = makeRun()) {
  server.use(
    http.get(`*/api/runbook-runs/${RUN_ID}`, () => HttpResponse.json({ data: run })),
    http.get('*/api/runbook-runs/*/targets/*/steps/*/log', () => HttpResponse.text('history line\n')),
  );
}

function renderPage(width = 1280) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]));
    return { matches, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() };
  }) as unknown as typeof window.matchMedia;
  return render(
    <Routes>
      <Route path="/runs/:id" element={<RunDetailPage />} />
    </Routes>,
    { wrapperOptions: { route: `/runs/${RUN_ID}`, user: runbookUser(['runbooks:read', 'runbooks:run']) } },
  );
}

const { aiOn } = vi.hoisted(() => ({ aiOn: { value: true } }));
vi.mock('../../../features/runbooks/hooks/useRunbookAiAvailable', () => ({ useRunbookAiAvailable: () => aiOn.value }));

describe('RunDetailPage', () => {
  beforeEach(() => {
    streams.length = 0;
    terminals.length = 0;
  });

  it('renders each matrix cell with an icon and a text label, and the run header', async () => {
    const run = makeRun([makeTarget(0, 2), makeTarget(1, 2)]);
    run.targets[0]!.steps[0] = makeStep(run.targets[0]!.id, 0, { status: 'failed', exitCode: 3, durationMs: 2500 });
    serveRun(run);
    renderPage();
    expect(await screen.findByRole('table', { name: /Run matrix/ })).toBeInTheDocument();
    const cell = screen.getByRole('button', { name: /server-000, Step 1: Failed, 2\.5 s, exit 3/ });
    expect(within(cell).getByText('Failed')).toBeInTheDocument();
    expect(within(cell).getByText('2.5 s · exit 3')).toBeInTheDocument();
    expect(cell.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Patch web tier');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('patches the matrix from stream events without refetching', async () => {
    let gets = 0;
    const run = makeRun();
    server.use(
      http.get(`*/api/runbook-runs/${RUN_ID}`, () => {
        gets += 1;
        return HttpResponse.json({ data: run });
      }),
    );
    renderPage();
    await screen.findByRole('table', { name: /Run matrix/ });
    const stream = streams.at(-1)!;
    act(() => {
      stream.onEvent({ type: 'step', runId: RUN_ID, targetId: run.targets[1]!.id, stepIndex: 1, status: 'running' });
      stream.onEvent({ type: 'step', runId: RUN_ID, targetId: run.targets[1]!.id, stepIndex: 0, status: 'succeeded', exitCode: 0, durationMs: 900 });
      stream.onEvent({ type: 'target', runId: RUN_ID, targetId: run.targets[1]!.id, status: 'running' });
    });
    expect(await screen.findByRole('button', { name: /server-001, Step 2: Running/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /server-001, Step 1: Succeeded, 900 ms/ })).toBeInTheDocument();
    expect(gets).toBe(1);
  });

  it('renders cards at phone width and opens the log as a full-screen sheet', async () => {
    serveRun();
    renderPage(360);
    const cards = await screen.findAllByTestId('run-card');
    expect(cards).toHaveLength(2);
    expect(screen.queryByRole('table', { name: /Run matrix/ })).not.toBeInTheDocument();
    await userEvent.click(within(cards[0]!).getByRole('button', { name: /server-000: Pending/ }));
    expect(await screen.findByRole('dialog', { name: 'server-000' })).toBeInTheDocument();
  });

  it('mounts only the visible rows of a 500 x 10 matrix, quickly', async () => {
    const targets = Array.from({ length: 500 }, (_, i) => makeTarget(i, 10));
    serveRun(makeRun(targets));
    const started = performance.now();
    renderPage();
    await screen.findByRole('table', { name: /Run matrix/ });
    const elapsed = performance.now() - started;
    const rows = screen.getAllByTestId('matrix-row');
    expect(rows.length).toBeLessThan(30);
    expect(screen.getByRole('table', { name: /Run matrix/ })).toHaveAttribute('aria-rowcount', '501');
    // First paint budget of the issue (300 ms) with headroom for a slow CI box; the network
    // round trip of the mocked GET is inside the measurement.
    expect(elapsed).toBeLessThan(3000);
  });

  it('appends live chunks in seq order to the open log and drops replays', async () => {
    const run = makeRun();
    serveRun(run);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /server-000, Step 1: Pending/ }));
    await waitFor(() => expect(terminals.at(-1)?.written.join('')).toContain('history line'));
    const stream = streams.at(-1)!;
    const t = run.targets[0]!;
    const chunk = (seq: number, data: string) => ({ type: 'chunk' as const, runId: RUN_ID, targetId: t.id, stepIndex: 0, stepRowId: t.steps[0]!.id, seq, stream: 'stdout' as const, data });
    act(() => {
      stream.onEvent(chunk(5, 'five\n'));
      stream.onEvent(chunk(7, 'seven\n'));
      stream.onEvent(chunk(6, 'six\n'));
      stream.onEvent(chunk(6, 'six\n'));
      stream.onEvent(chunk(5, 'five\n'));
    });
    const written = terminals.at(-1)!.written.join('');
    expect(written).toBe('history line\r\nfive\r\nsix\r\nseven\r\n');
  });

  it('has no axe violations', async () => {
    serveRun();
    const { container } = renderPage();
    await screen.findByRole('table', { name: /Run matrix/ });
    const v = (await axe(container)).violations;
    expect(v).toEqual([]);
  });

  it('offers Stop AI while an ai_task step works, and posts to the stop route', async () => {
    const run = makeRun([makeTarget(0, 2)], { status: 'running', finishedAt: null });
    run.targets[0]!.steps[0] = makeStep(run.targets[0]!.id, 0, { kind: 'ai_task', status: 'running', name: 'Fix nginx' });
    serveRun(run);
    const stops: string[] = [];
    server.use(
      http.post(`*/api/runbook-runs/${RUN_ID}/ai/stop`, ({ request }) => {
        stops.push(new URL(request.url).pathname);
        return HttpResponse.json({ data: { id: RUN_ID, stopRequested: true, stoppedSteps: 0 } }, { status: 202 });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Stop AI' }));
    await waitFor(() => expect(stops).toEqual([`/api/runbook-runs/${RUN_ID}/ai/stop`]));
  });

  it('shows no Stop AI when no step is an AI step that is working', async () => {
    const run = makeRun([makeTarget(0, 2)], { status: 'running', finishedAt: null });
    serveRun(run);
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Stop AI' })).not.toBeInTheDocument();
  });
});
