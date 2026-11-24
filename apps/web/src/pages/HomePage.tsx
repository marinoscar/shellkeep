import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Grid, Skeleton, Typography } from '@mui/material';
import { Add as AddIcon, Dns as DnsIcon } from '@mui/icons-material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@marinoscar/platform-web/identity/headless';
import { FleetHealthTiles } from '../components/home/FleetHealthTiles';
import { ActiveSessionsPanel } from '../components/home/ActiveSessionsPanel';
import { QuickConnectPanel } from '../components/home/QuickConnectPanel';
import { RecentRunsPanel } from '../components/home/RecentRunsPanel';
import { NewSessionDialog } from '../components/terminal/NewSessionDialog';
import { useDashboardSummary } from '../hooks/useDashboardSummary';
import { createSession } from '../services/terminal-api';
import type { CreateSessionData } from '../types';

/** Page-content columns (MUI Grid size props only, never a chrome gate): 1 below md, 2 at md, 3 at lg. */
const PANEL_SIZE = { xs: 12, md: 6, lg: 4 } as const;

/**
 * Home (#78): which servers are unhealthy, what is running now and what failed recently, from
 * ONE read (`GET /api/dashboard/summary`), refreshed on focus and every 30 s while visible.
 * The shell draws `<main>` padded; this page adds no chrome and reads no breakpoint.
 */
export default function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const { summary, isLoading, error } = useDashboardSummary();

  const handleCreateSession = async (data: CreateSessionData) => {
    const session = await createSession(data);
    navigate(`/sessions/${session.id}`);
  };

  const noServers = summary?.servers?.total === 0;

  return (
    <Box sx={{ maxWidth: 1600, mx: 'auto', minWidth: 0 }}>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          mb: 3,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h1" sx={{ overflowWrap: 'anywhere' }}>
            Home
          </Typography>
          <Typography sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
            Welcome back{user?.displayName ? `, ${user.displayName}` : ''}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewSessionOpen(true)}>
          New session
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {summary ? `Could not refresh the dashboard: ${error}` : `Could not load the dashboard: ${error}`}
        </Alert>
      )}

      {noServers && (
        <Card variant="outlined" sx={{ mb: 3 }} data-testid="home-empty-servers">
          <CardContent sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
            <DnsIcon sx={{ color: 'text.secondary' }} aria-hidden="true" />
            <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
              <Typography variant="subtitle1" component="h2">
                Add your first server
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Save a server profile, verify its host key, then open a session that keeps running after you close the tab.
              </Typography>
            </Box>
            <Button variant="outlined" component={RouterLink} to="/servers?new=1">
              Add a server
            </Button>
          </CardContent>
        </Card>
      )}

      <Box sx={{ mb: 3 }}>
        {summary ? (
          <FleetHealthTiles summary={summary} />
        ) : isLoading ? (
          <Grid container spacing={2} aria-busy="true" aria-label="Loading fleet health">
            {[0, 1, 2, 3].map((i) => (
              <Grid key={i} size={{ xs: 12, sm: 6, md: 4, xl: 2 }}>
                <Skeleton variant="rounded" height={112} />
              </Grid>
            ))}
          </Grid>
        ) : null}
      </Box>

      <Grid container spacing={3}>
        <Grid size={PANEL_SIZE}>
          <ActiveSessionsPanel
            sessions={summary?.sessions.recent ?? []}
            total={summary?.sessions.active ?? 0}
            isLoading={isLoading && !summary}
            hasServers={!noServers}
          />
        </Grid>
        {summary?.runs && (
          <Grid size={PANEL_SIZE} data-testid="home-recent-runs">
            <RecentRunsPanel runs={summary.runs} />
          </Grid>
        )}
        <Grid size={PANEL_SIZE}>
          <QuickConnectPanel />
        </Grid>
      </Grid>

      <NewSessionDialog
        open={newSessionOpen}
        onClose={() => setNewSessionOpen(false)}
        onCreate={handleCreateSession}
      />
    </Box>
  );
}
