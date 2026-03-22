import { useState, useCallback, useEffect } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { TerminalView } from '../components/terminal/TerminalView';
import { TerminalToolbar } from '../components/terminal/TerminalToolbar';
import { getSession, updateSession } from '../services/api';
import type { TerminalSession } from '../types';

export default function TerminalPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [isConnected, setIsConnected] = useState(false);

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

  const handleRename = useCallback(
    async (newName: string) => {
      if (!id) return;
      try {
        const updated = await updateSession(id, { name: newName });
        setSession(updated);
      } catch {
        // Silently fail - could add error handling
      }
    },
    [id],
  );

  const handleOpenNewTab = useCallback(() => {
    if (id) {
      window.open(`/terminal/${id}`, '_blank');
    }
  }, [id]);

  const handleDisconnect = useCallback(() => {
    navigate('/sessions');
  }, [navigate]);

  if (!id || !session) {
    return null;
  }

  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 64px)',
      m: -3, // counteract Layout's p:3
      overflow: 'hidden',
    }}>
      {/* Back button + Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <Tooltip title="Back to sessions">
          <IconButton onClick={() => navigate('/sessions')} sx={{ ml: 1 }}>
            <ArrowBackIcon />
          </IconButton>
        </Tooltip>
        <Box sx={{ flexGrow: 1 }}>
          <TerminalToolbar
            sessionName={session.name}
            isConnected={isConnected}
            onOpenNewTab={handleOpenNewTab}
            onDisconnect={handleDisconnect}
            onRename={handleRename}
          />
        </Box>
      </Box>

      {/* Terminal */}
      <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'hidden' }}>
        <TerminalView
          sessionId={id}
          onConnectionChange={handleConnectionChange}
        />
      </Box>
    </Box>
  );
}
