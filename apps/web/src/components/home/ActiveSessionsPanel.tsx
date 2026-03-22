import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Box,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Chip,
  CircularProgress,
} from '@mui/material';
import {
  OpenInNew as OpenIcon,
  Terminal as TerminalIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { getSessions } from '../../services/api';
import type { TerminalSession } from '../../types';

function getRelativeTime(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return date.toLocaleDateString();
}

export function ActiveSessionsPanel() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getSessions({ status: 'active', pageSize: 6 }),
      getSessions({ status: 'detached', pageSize: 6 }),
    ])
      .then(([activeRes, detachedRes]) => {
        const combined = [...(activeRes?.items ?? []), ...(detachedRes?.items ?? [])].slice(0, 6);
        setSessions(combined);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">
            Active Sessions
          </Typography>
          <Button size="small" onClick={() => navigate('/sessions')}>
            View All
          </Button>
        </Box>

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : sessions.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <TerminalIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography color="text.secondary" variant="body2">
              No active sessions.
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Start one from your saved servers.
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {sessions.map((session) => (
              <ListItem
                key={session.id}
                sx={{
                  px: 1,
                  borderRadius: 1,
                  '&:hover': { bgcolor: 'action.hover' },
                  cursor: 'pointer',
                }}
                onClick={() => navigate(`/sessions/${session.id}/terminal`)}
              >
                <ListItemText
                  primary={session.name}
                  secondary={`${session.serverProfile.username}@${session.serverProfile.hostname} - ${getRelativeTime(session.lastActivityAt)}`}
                  primaryTypographyProps={{ noWrap: true, variant: 'body2' }}
                  secondaryTypographyProps={{ noWrap: true, variant: 'caption' }}
                />
                <ListItemSecondaryAction>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Chip
                      label={session.status}
                      size="small"
                      color={session.status === 'active' ? 'success' : 'warning'}
                      sx={{ height: 20, fontSize: '0.7rem' }}
                    />
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<OpenIcon sx={{ fontSize: '14px !important' }} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/sessions/${session.id}/terminal`);
                      }}
                      sx={{ minWidth: 'auto', fontSize: '0.75rem' }}
                    >
                      Open
                    </Button>
                  </Box>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}
