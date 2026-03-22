import { useState, useCallback, useEffect } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Circle as CircleIcon,
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { TerminalView } from '../components/terminal/TerminalView';
import { getSession } from '../services/api';
import type { TerminalSession } from '../types';

export default function TerminalFullPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);

  useEffect(() => {
    if (id) {
      getSession(id)
        .then(setSession)
        .catch(() => {
          navigate('/sessions');
        });
    }
  }, [id, navigate]);

  const handleConnectionChange = useCallback((connected: boolean) => {
    setIsConnected(connected);
  }, []);

  if (!id || !session) {
    return null;
  }

  return (
    <Box
      sx={{ width: '100vw', height: '100vh', position: 'relative', bgcolor: '#1e1e1e' }}
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => setShowToolbar(false)}
    >
      {/* Floating toolbar */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1,
          py: 0.5,
          bgcolor: 'rgba(30, 30, 30, 0.9)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          opacity: showToolbar ? 1 : 0,
          transition: 'opacity 0.3s ease',
          pointerEvents: showToolbar ? 'auto' : 'none',
        }}
      >
        <Tooltip title="Back to sessions">
          <IconButton
            size="small"
            onClick={() => navigate('/sessions')}
            sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
          >
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <CircleIcon
          sx={{
            fontSize: 10,
            color: isConnected ? '#4caf50' : '#f44336',
          }}
        />

        <Typography
          variant="body2"
          sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
          noWrap
        >
          {session.name} - {session.serverProfile.username}@{session.serverProfile.hostname}
        </Typography>
      </Box>

      {/* Full-screen terminal */}
      <TerminalView
        sessionId={id}
        onConnectionChange={handleConnectionChange}
      />
    </Box>
  );
}
