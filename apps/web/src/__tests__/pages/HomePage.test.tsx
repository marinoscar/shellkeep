import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { render, mockUser } from '../utils/test-utils';
import HomePage from '../../pages/HomePage';
import type { DashboardSummary } from '../../types/dashboard';
import { makeDashboardRuns, makeDashboardSummary } from '../components/home/dashboardFixtures';

// Mock NewSessionDialog to avoid xterm dependencies
vi.mock('../../components/terminal/NewSessionDialog', () => ({
  NewSessionDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="new-session-dialog" /> : null),
}));

let summary: DashboardSummary;
let summaryCalls = 0;

/** HomePage reads the dashboard summary; Quick connect still lists profiles itself. */
function useHandlers() {
  server.use(
    http.get('*/api/dashboard/summary', () => {
      summaryCalls += 1;
      return HttpResponse.json({ data: summary });
    }),
    http.get('*/api/server-profiles', () => HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 4 } })),
  );
}

/** Wait until the summary and Quick connect have settled, so no setState lands after teardown. */
async function settled() {
  await waitFor(() => {
    expect(screen.getByTestId('tile-sessions')).toBeInTheDocument();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });
}

describe('HomePage', () => {
  beforeEach(() => {
    summary = makeDashboardSummary();
    summaryCalls = 0;
    useHandlers();
  });

  it('greets the user and offers a new session', async () => {
    render(<HomePage />, { wrapperOptions: { user: mockUser } });
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(screen.getByText('Welcome back, Test User')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /new session/i }));
    expect(screen.getByTestId('new-session-dialog')).toBeInTheDocument();
    await settled();
  });

  it('shows the six tiles, the active sessions and the recent runs when the summary carries runs', async () => {
    summary = makeDashboardSummary({ runs: makeDashboardRuns() });
    render(<HomePage />);
    await settled();

    expect(within(screen.getByRole('list', { name: 'Fleet health' })).getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByTestId('tile-failed')).toHaveAttribute('href', '/runs?status=failed&since=24h');
    expect(screen.getByRole('link', { name: 'Open deploy-hotfix' })).toHaveAttribute('href', '/sessions/session-1');
    expect(screen.getByRole('heading', { name: 'Recent runs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Patch and collect logs/ })).toHaveAttribute('href', '/runs/run-1');
    expect(screen.getByRole('heading', { name: 'Quick Connect' })).toBeInTheDocument();
  });

  it('hides the runs section and the run tiles when runs is null', async () => {
    summary = makeDashboardSummary({ runs: null });
    render(<HomePage />);
    await settled();

    expect(screen.queryByTestId('home-recent-runs')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recent runs' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('tile-running')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tile-failed')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem').filter((li) => li.closest('[aria-label="Fleet health"]'))).toHaveLength(4);
  });

  it('links an empty fleet to adding the first server', async () => {
    summary = makeDashboardSummary({
      servers: { total: 0, reachable: 0, unreachable: 0, unknown: 0, hostKeyUntrusted: 0 },
      sessions: { active: 0, attached: 0, detached: 0, recent: [] },
    });
    render(<HomePage />);
    await settled();

    const empty = screen.getByTestId('home-empty-servers');
    expect(within(empty).getByRole('heading', { name: 'Add your first server' })).toBeInTheDocument();
    expect(within(empty).getByRole('link', { name: 'Add a server' })).toHaveAttribute('href', '/servers?new=1');
    expect(screen.getByRole('link', { name: 'Add your first server' })).toHaveAttribute('href', '/servers?new=1');
  });

  it('shows no empty-fleet card while the caller has servers', async () => {
    render(<HomePage />);
    await settled();
    expect(screen.queryByTestId('home-empty-servers')).not.toBeInTheDocument();
  });

  it('reports a failed load', async () => {
    server.use(http.get('*/api/dashboard/summary', () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
    render(<HomePage />);
    expect(await screen.findByText(/Could not load the dashboard/)).toBeInTheDocument();
  });

  it('refreshes when the window regains focus', async () => {
    render(<HomePage />);
    await settled();
    const before = summaryCalls;
    summary = makeDashboardSummary({ sessions: { ...summary.sessions, active: 9, attached: 9, detached: 0 } });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(within(screen.getByTestId('tile-sessions')).getByText('9')).toBeInTheDocument());
    expect(summaryCalls).toBeGreaterThan(before);
  });

  it('lays the panels out as one column on a phone, two at md and three at lg (Grid size props only)', async () => {
    summary = makeDashboardSummary({ runs: makeDashboardRuns() });
    const { container } = render(<HomePage />);
    await settled();
    // MUI Grid v2 encodes each size prop as a class; xs-12 is the single phone column.
    const panels = container.querySelectorAll('.MuiGrid-container.MuiGrid-spacing-xs-3 > .MuiGrid-root');
    expect(panels).toHaveLength(3);
    for (const panel of panels) {
      expect(panel.className).toMatch(/MuiGrid-grid-xs-12/);
      expect(panel.className).toMatch(/MuiGrid-grid-md-6/);
      expect(panel.className).toMatch(/MuiGrid-grid-lg-4/);
    }
  });
});
