import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  List,
  ListItem,
  ListItemText,
  Chip,
  CircularProgress,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { getSessions } from '../../services/api';
import type { TerminalSession } from '../../types';

function getRelativeTime(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function getStatusColor(status: string): 'success' | 'warning' | 'default' {
  switch (status) {
    case 'active':
      return 'success';
    case 'detached':
      return 'warning';
    default:
      return 'default';
  }
}

export function RecentActivityPanel() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getSessions({ pageSize: 5 })
      .then((res) => setSessions(res?.items ?? []))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Recent Activity
        </Typography>

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : sessions.length === 0 ? (
          <Typography color="text.secondary" variant="body2" sx={{ py: 2 }}>
            No recent activity.
          </Typography>
        ) : (
          <List disablePadding>
            {sessions.map((session) => (
              <ListItem
                key={session.id}
                sx={{
                  px: 1,
                  borderRadius: 1,
                  '&:hover': { bgcolor: 'action.hover' },
                  cursor: session.status !== 'terminated' ? 'pointer' : 'default',
                }}
                onClick={() => {
                  if (session.status !== 'terminated') {
                    navigate(`/sessions/${session.id}/terminal`);
                  }
                }}
              >
                <ListItemText
                  primary={session.name}
                  secondary={`${session.serverProfile.name} (${session.serverProfile.username}@${session.serverProfile.hostname})`}
                  primaryTypographyProps={{ variant: 'body2' }}
                  secondaryTypographyProps={{ variant: 'caption' }}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 1 }}>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {getRelativeTime(session.lastActivityAt)}
                  </Typography>
                  <Chip
                    label={session.status}
                    size="small"
                    color={getStatusColor(session.status)}
                    variant={session.status === 'terminated' ? 'outlined' : 'filled'}
                    sx={{ height: 20, fontSize: '0.7rem' }}
                  />
                </Box>
              </ListItem>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}
