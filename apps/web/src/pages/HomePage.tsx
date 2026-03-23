import { useState } from 'react';
import { Box, Container, Typography, Grid } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { SessionStatsBar } from '../components/home/SessionStatsBar';
import { ActiveSessionsPanel } from '../components/home/ActiveSessionsPanel';
import { QuickConnectPanel } from '../components/home/QuickConnectPanel';
import { RecentActivityPanel } from '../components/home/RecentActivityPanel';
import { NewSessionDialog } from '../components/terminal/NewSessionDialog';
import { createSession } from '../services/api';
import { CreateSessionData } from '../types';

export default function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  const handleCreateSession = async (data: CreateSessionData) => {
    const session = await createSession(data);
    navigate(`/sessions/${session.id}/terminal`);
  };

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
        <SessionStatsBar onNewSession={() => setNewSessionOpen(true)} />

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

        {/* Recent Activity */}
        <RecentActivityPanel />

        <NewSessionDialog
          open={newSessionOpen}
          onClose={() => setNewSessionOpen(false)}
          onCreate={handleCreateSession}
        />
      </Box>
    </Container>
  );
}
