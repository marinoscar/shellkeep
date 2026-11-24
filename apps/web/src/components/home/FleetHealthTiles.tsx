import { Card, CardActionArea, CardContent, Grid, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import type { DashboardSummary } from '../../types/dashboard';

type Tone = 'default' | 'warning' | 'error';

export interface FleetTile {
  key: 'servers' | 'unreachable' | 'untrusted' | 'sessions' | 'running' | 'failed';
  label: string;
  value: number;
  caption: string;
  /** The filtered list the tile opens. */
  href: string;
  tone: Tone;
}

/**
 * The tiles of the Home page (#78), each a link to its filtered list. The server tiles are left
 * out when `servers` is `null` (no `servers:read`), the run tiles when `runs` is `null` (no
 * `runbooks:read`, or no runs recorded yet): the API decides, the page only follows.
 */
export function fleetTiles(summary: DashboardSummary): FleetTile[] {
  const tiles: FleetTile[] = [];
  const { servers, sessions, runs } = summary;
  if (servers) {
    const checked = servers.total - servers.unknown;
    tiles.push(
      {
        key: 'servers',
        label: 'Servers',
        value: servers.total,
        caption: checked > 0 ? `${servers.reachable} of ${checked} checked reachable` : 'Reachability not checked yet',
        href: '/servers',
        tone: 'default',
      },
      {
        key: 'unreachable',
        label: 'Unreachable',
        value: servers.unreachable,
        caption: servers.unknown > 0 ? `${servers.unknown} not checked yet` : 'From the last connection test',
        href: '/servers?health=unreachable',
        tone: servers.unreachable > 0 ? 'error' : 'default',
      },
      {
        key: 'untrusted',
        label: 'Untrusted host keys',
        value: servers.hostKeyUntrusted,
        caption: servers.hostKeyUntrusted > 0 ? 'Verify before connecting' : 'All host keys verified',
        href: '/servers?hostKey=untrusted',
        tone: servers.hostKeyUntrusted > 0 ? 'warning' : 'default',
      },
    );
  }
  tiles.push({
    key: 'sessions',
    label: 'Active sessions',
    value: sessions.active,
    caption: `${sessions.attached} attached · ${sessions.detached} detached`,
    href: '/sessions?status=active',
    tone: 'default',
  });
  if (runs) {
    tiles.push(
      {
        key: 'running',
        label: 'Running runs',
        value: runs.running,
        caption: 'In progress now',
        href: '/runs?status=running',
        tone: 'default',
      },
      {
        key: 'failed',
        label: 'Failed (24h)',
        value: runs.failedLast24h,
        caption: 'Runs that failed in the last 24 hours',
        href: '/runs?status=failed&since=24h',
        tone: runs.failedLast24h > 0 ? 'error' : 'default',
      },
    );
  }
  return tiles;
}

const toneColor: Record<Tone, string> = {
  default: 'text.primary',
  warning: 'warning.main',
  error: 'error.main',
};

export function FleetHealthTiles({ summary }: { summary: DashboardSummary }) {
  return (
    <Grid container spacing={2} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }} aria-label="Fleet health">
      {fleetTiles(summary).map((tile) => (
        // Page-content breakpoints only (never a chrome gate): 1 column on a phone, 2, 3, then 6.
        <Grid key={tile.key} component="li" size={{ xs: 12, sm: 6, md: 4, xl: 2 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardActionArea
              component={RouterLink}
              to={tile.href}
              data-testid={`tile-${tile.key}`}
              aria-label={`${tile.label}: ${tile.value}. ${tile.caption}`}
              sx={{ height: '100%' }}
            >
              <CardContent>
                <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.5, display: 'block' }}>
                  {tile.label}
                </Typography>
                <Typography variant="h4" component="p" sx={{ color: toneColor[tile.tone], fontWeight: 600 }}>
                  {tile.value}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
                  {tile.caption}
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}
