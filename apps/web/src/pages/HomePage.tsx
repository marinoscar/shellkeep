import { Box, Container, Typography, Grid } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { SessionStatsBar } from '../components/home/SessionStatsBar';
import { ActiveSessionsPanel } from '../components/home/ActiveSessionsPanel';
import { QuickConnectPanel } from '../components/home/QuickConnectPanel';
import { RecentActivityPanel } from '../components/home/RecentActivityPanel';
import { QuickActions } from '../components/home/QuickActions';

export default function HomePage() {
  const { user } = useAuth();

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        {/* Welcome Header */}
        <Typography variant="h4" component="h1" gutterBottom>
          Welcome back{user?.displayName ? `, ${user.displayName}` : ''}
        </Typography>
        <Typography color="text.secondary" paragraph>
          ShellKeep Control Center
        </Typography>

        {/* Stats Bar */}
        <SessionStatsBar />

        {/* Main Grid */}
        <Grid container spacing={3} sx={{ mb: 3 }}>
          {/* Active Sessions Panel */}
          <Grid item xs={12} md={8}>
            <ActiveSessionsPanel />
          </Grid>

          {/* Quick Connect Panel */}
          <Grid item xs={12} md={4}>
            <QuickConnectPanel />
          </Grid>
        </Grid>

        {/* Quick Actions */}
        <Box sx={{ mb: 3 }}>
          <QuickActions />
        </Box>

        {/* Recent Activity */}
        <RecentActivityPanel />
      </Box>
    </Container>
  );
}
