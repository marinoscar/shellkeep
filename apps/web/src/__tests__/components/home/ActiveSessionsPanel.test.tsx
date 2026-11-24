import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../../utils/test-utils';
import { ActiveSessionsPanel } from '../../../components/home/ActiveSessionsPanel';
import { makeDashboardSession } from './dashboardFixtures';

describe('ActiveSessionsPanel', () => {
  it('lists each session with its server and a link into the workspace', () => {
    render(
      <ActiveSessionsPanel
        total={2}
        sessions={[
          makeDashboardSession(),
          makeDashboardSession({ id: 'session-2', name: 'logs-tail', status: 'detached', serverName: 'server-b' }),
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Active sessions' })).toBeInTheDocument();
    expect(screen.getByText('deploy-hotfix')).toBeInTheDocument();
    expect(screen.getByText(/server-a · 2m ago/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open deploy-hotfix' })).toHaveAttribute('href', '/sessions/session-1');
    expect(screen.getByRole('link', { name: 'Resume logs-tail' })).toHaveAttribute('href', '/sessions/session-2');
  });

  it('links to all sessions, with the total when more exist than are shown', () => {
    render(<ActiveSessionsPanel total={7} sessions={[makeDashboardSession()]} />);
    expect(screen.getByRole('link', { name: 'All sessions (7)' })).toHaveAttribute('href', '/sessions');
  });

  it('shows a loading indicator', () => {
    render(<ActiveSessionsPanel total={0} sessions={[]} isLoading />);
    expect(screen.getByRole('progressbar', { name: 'Loading sessions' })).toBeInTheDocument();
  });

  it('points at Quick connect when there are servers but no session', () => {
    render(<ActiveSessionsPanel total={0} sessions={[]} />);
    expect(screen.getByText('No active sessions.')).toBeInTheDocument();
    expect(screen.getByText('Start one from Quick connect.')).toBeInTheDocument();
  });

  it('links to adding a first server when the caller has none', () => {
    render(<ActiveSessionsPanel total={0} sessions={[]} hasServers={false} />);
    expect(screen.getByRole('link', { name: 'Add your first server' })).toHaveAttribute('href', '/servers?new=1');
  });
});
