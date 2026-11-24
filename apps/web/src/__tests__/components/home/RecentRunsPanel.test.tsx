import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../../utils/test-utils';
import { RecentRunsPanel } from '../../../components/home/RecentRunsPanel';
import { makeDashboardRuns } from './dashboardFixtures';

describe('RecentRunsPanel', () => {
  it('shows each run with its runbook, target count, status bar and a link to the run', () => {
    render(<RecentRunsPanel runs={makeDashboardRuns()} />);

    const row = screen.getByRole('link', { name: /Patch and collect logs/ });
    expect(row).toHaveAttribute('href', '/runs/run-1');
    expect(screen.getByText(/running · 4 targets · started 5m ago/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '2 succeeded, 1 failed, 1 running' })).toBeInTheDocument();
    expect(screen.getByTestId('bar-succeeded')).toHaveStyle({ width: '50%' });
    expect(screen.getByTestId('bar-failed')).toHaveStyle({ width: '25%' });
    expect(screen.getByRole('link', { name: 'All runs' })).toHaveAttribute('href', '/runs');
  });

  it('links to creating a runbook when there are no runs yet', () => {
    render(<RecentRunsPanel runs={makeDashboardRuns({ recent: [], running: 0, failedLast24h: 0 })} />);
    expect(screen.getByText('No runs yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a runbook' })).toHaveAttribute('href', '/runbooks');
  });
});
