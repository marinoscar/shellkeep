import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';
import { Terminal as TerminalIcon } from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import type { DashboardSessionSummary } from '../../types/dashboard';
import { relativeTime } from './relativeTime';

export interface ActiveSessionsPanelProps {
  /** The most recently used live sessions (at most five, from the dashboard summary). */
  sessions: DashboardSessionSummary[];
  /** How many live sessions the caller has in all. */
  total: number;
  isLoading?: boolean;
  /** Whether the caller can see any server; with none, the empty state points at adding one. */
  hasServers?: boolean;
}

/** The caller's live sessions on Home (#78). "Resume" opens the workspace at `/sessions/:id`. */
export function ActiveSessionsPanel({ sessions, total, isLoading = false, hasServers = true }: ActiveSessionsPanelProps) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }} component="section" aria-labelledby="home-active-sessions">
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 1 }}>
          <Typography variant="h6" component="h2" id="home-active-sessions">
            Active sessions
          </Typography>
          <Button size="small" component={RouterLink} to="/sessions">
            All sessions{total > sessions.length ? ` (${total})` : ''}
          </Button>
        </Box>

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} aria-label="Loading sessions" />
          </Box>
        ) : sessions.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <TerminalIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} aria-hidden="true" />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No active sessions.
            </Typography>
            {hasServers ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Start one from Quick connect.
              </Typography>
            ) : (
              <Button size="small" variant="outlined" component={RouterLink} to="/servers?new=1" sx={{ mt: 1 }}>
                Add your first server
              </Button>
            )}
          </Box>
        ) : (
          <List disablePadding>
            {sessions.map((session) => (
              <ListItem
                key={session.id}
                disableGutters
                sx={{ py: 0.75 }}
                secondaryAction={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip
                      label={session.status === 'active' ? 'attached' : 'detached'}
                      size="small"
                      color={session.status === 'active' ? 'success' : 'default'}
                      variant="outlined"
                      sx={{ height: 20, fontSize: '0.7rem', display: { xs: 'none', sm: 'inline-flex' } }}
                    />
                    <Button
                      size="small"
                      variant={session.status === 'detached' ? 'outlined' : 'text'}
                      component={RouterLink}
                      to={`/sessions/${session.id}`}
                      aria-label={`${session.status === 'detached' ? 'Resume' : 'Open'} ${session.name}`}
                    >
                      {session.status === 'detached' ? 'Resume' : 'Open'}
                    </Button>
                  </Box>
                }
              >
                <ListItemText
                  sx={{ minWidth: 0, pr: { xs: 10, sm: 20 } }}
                  primary={session.name}
                  secondary={`${session.serverName} · ${relativeTime(session.lastActivityAt)}`}
                  slotProps={{
                    primary: { noWrap: true, variant: 'body2' },
                    secondary: { noWrap: true, variant: 'caption' },
                  }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}
