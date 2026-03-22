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
  CircularProgress,
} from '@mui/material';
import {
  Dns as DnsIcon,
  PlayArrow as ConnectIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { getServerProfiles, createSession } from '../../services/api';
import type { ServerProfile } from '../../types';

export function QuickConnectPanel() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  useEffect(() => {
    getServerProfiles({ pageSize: 4 })
      .then((res) => setProfiles(res?.items ?? []))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const handleConnect = async (profile: ServerProfile) => {
    setConnectingId(profile.id);
    try {
      const session = await createSession({ serverProfileId: profile.id });
      navigate(`/sessions/${session.id}/terminal`);
    } catch {
      // Error handled silently; user will see navigation doesn't happen
    } finally {
      setConnectingId(null);
    }
  };

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">
            Quick Connect
          </Typography>
          <Button size="small" onClick={() => navigate('/servers')}>
            Manage Servers
          </Button>
        </Box>

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : profiles.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <DnsIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography color="text.secondary" variant="body2">
              Add a server to get started.
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={() => navigate('/servers')}
              sx={{ mt: 1 }}
            >
              Add Server
            </Button>
          </Box>
        ) : (
          <List disablePadding>
            {profiles.map((profile) => (
              <ListItem
                key={profile.id}
                sx={{
                  px: 1,
                  borderRadius: 1,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <ListItemText
                  primary={profile.name}
                  secondary={`${profile.username}@${profile.hostname}:${profile.port}`}
                  primaryTypographyProps={{ noWrap: true, variant: 'body2' }}
                  secondaryTypographyProps={{ noWrap: true, variant: 'caption' }}
                />
                <ListItemSecondaryAction>
                  <Button
                    size="small"
                    variant="outlined"
                    color="primary"
                    startIcon={
                      connectingId === profile.id ? (
                        <CircularProgress size={14} />
                      ) : (
                        <ConnectIcon sx={{ fontSize: '14px !important' }} />
                      )
                    }
                    onClick={() => handleConnect(profile)}
                    disabled={connectingId !== null}
                    sx={{ minWidth: 'auto', fontSize: '0.75rem' }}
                  >
                    Connect
                  </Button>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}
