import { useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Grid,
  Button,
  Box,
} from '@mui/material';
import {
  Add as AddIcon,
  Terminal as TerminalIcon,
  Dns as DnsIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { NewSessionDialog } from '../terminal/NewSessionDialog';
import { createSession } from '../../services/api';
import type { CreateSessionData } from '../../types';

interface QuickAction {
  title: string;
  description: string;
  icon: React.ReactNode;
  path?: string;
  onClick?: () => void;
  primary?: boolean;
}

export function QuickActions() {
  const navigate = useNavigate();
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  const handleCreateSession = async (data: CreateSessionData) => {
    const session = await createSession(data);
    navigate(`/sessions/${session.id}/terminal`);
  };

  const quickActions: QuickAction[] = [
    {
      title: 'New Session',
      description: 'Connect to a server',
      icon: <AddIcon />,
      onClick: () => setNewSessionOpen(true),
      primary: true,
    },
    {
      title: 'All Sessions',
      description: 'View terminal sessions',
      icon: <TerminalIcon />,
      path: '/sessions',
    },
    {
      title: 'Manage Servers',
      description: 'Configure server profiles',
      icon: <DnsIcon />,
      path: '/servers',
    },
  ];

  return (
    <>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Quick Actions
          </Typography>

          <Grid container spacing={2}>
            {quickActions.map((action) => (
              <Grid item xs={12} sm={6} key={action.title}>
                <Button
                  fullWidth
                  variant={action.primary ? 'contained' : 'outlined'}
                  onClick={() => {
                    if (action.onClick) {
                      action.onClick();
                    } else if (action.path) {
                      navigate(action.path);
                    }
                  }}
                  sx={{
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    py: 2,
                    px: 2,
                  }}
                >
                  <Box sx={{ mr: 2, display: 'flex', color: action.primary ? 'inherit' : 'primary.main' }}>
                    {action.icon}
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" color={action.primary ? 'inherit' : undefined}>
                      {action.title}
                    </Typography>
                    <Typography
                      variant="caption"
                      color={action.primary ? 'inherit' : 'text.secondary'}
                      sx={{ opacity: action.primary ? 0.85 : 1 }}
                    >
                      {action.description}
                    </Typography>
                  </Box>
                </Button>
              </Grid>
            ))}
          </Grid>
        </CardContent>
      </Card>

      <NewSessionDialog
        open={newSessionOpen}
        onClose={() => setNewSessionOpen(false)}
        onCreate={handleCreateSession}
      />
    </>
  );
}
