import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { render } from '../../utils/test-utils';
import { FleetHealthTiles, fleetTiles } from '../../../components/home/FleetHealthTiles';
import { makeDashboardRuns, makeDashboardSummary } from './dashboardFixtures';

const hrefOf = (key: string) => screen.getByTestId(`tile-${key}`).getAttribute('href');

describe('FleetHealthTiles', () => {
  it('shows the six tiles, each a link to its filtered list, when the summary carries runs', () => {
    render(<FleetHealthTiles summary={makeDashboardSummary({ runs: makeDashboardRuns() })} />);

    const list = screen.getByRole('list', { name: 'Fleet health' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(6);
    expect(hrefOf('servers')).toBe('/servers');
    expect(hrefOf('unreachable')).toBe('/servers?health=unreachable');
    expect(hrefOf('untrusted')).toBe('/servers?hostKey=untrusted');
    expect(hrefOf('sessions')).toBe('/sessions?status=active');
    expect(hrefOf('running')).toBe('/runs?status=running');
    expect(hrefOf('failed')).toBe('/runs?status=failed&since=24h');
  });

  it('shows the counts and captions of the summary', () => {
    render(<FleetHealthTiles summary={makeDashboardSummary({ runs: makeDashboardRuns() })} />);

    expect(within(screen.getByTestId('tile-servers')).getByText('14')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-unreachable')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-unreachable')).getByText('1 not checked yet')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-untrusted')).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-sessions')).getByText('2 attached · 3 detached')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-running')).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-failed')).getByText('2')).toBeInTheDocument();
  });

  it('says reachability is not checked when no server has a stored test result', () => {
    const summary = makeDashboardSummary({
      servers: { total: 3, reachable: 0, unreachable: 0, unknown: 3, hostKeyUntrusted: 0 },
    });
    render(<FleetHealthTiles summary={summary} />);
    expect(within(screen.getByTestId('tile-servers')).getByText('Reachability not checked yet')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-untrusted')).getByText('All host keys verified')).toBeInTheDocument();
  });

  it('leaves the run tiles out when runs is null', () => {
    const tiles = fleetTiles(makeDashboardSummary({ runs: null }));
    expect(tiles.map((t) => t.key)).toEqual(['servers', 'unreachable', 'untrusted', 'sessions']);
  });

  it('leaves the server tiles out when servers is null (no servers:read)', () => {
    const tiles = fleetTiles(makeDashboardSummary({ servers: null, runs: makeDashboardRuns() }));
    expect(tiles.map((t) => t.key)).toEqual(['sessions', 'running', 'failed']);
  });

  it('names each tile for a screen reader, with its value and caption', () => {
    render(<FleetHealthTiles summary={makeDashboardSummary()} />);
    expect(screen.getByRole('link', { name: /^Untrusted host keys: 3\. Verify before connecting$/ })).toBeInTheDocument();
  });
});
