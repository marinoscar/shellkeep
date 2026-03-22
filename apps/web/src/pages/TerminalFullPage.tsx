import { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Chip, IconButton, Tooltip, Typography } from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Circle as CircleIcon,
  ContentCopy as CopyIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { TerminalView } from '../components/terminal/TerminalView';
import type { TerminalViewHandle } from '../components/terminal/TerminalView';
import { getSession } from '../services/api';
import type { TerminalSession } from '../types';

export default function TerminalFullPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const terminalViewRef = useRef<TerminalViewHandle>(null);
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

  const getTerminalText = useCallback((): string => {
    const terminal = terminalViewRef.current?.getTerminal();
    if (!terminal) return '';
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
    return lines.join('\n');
  }, []);

  const handleCopyAll = useCallback(() => {
    const text = getTerminalText();
    if (text) {
      navigator.clipboard.writeText(text);
    }
  }, [getTerminalText]);

  const handleDownload = useCallback(() => {
    const text = getTerminalText();
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session?.name || 'terminal'}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [getTerminalText, session?.name]);

  if (!id || !session) {
    return null;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', bgcolor: '#1e1e1e' }}>
      {/* Top bar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
          gap: 1,
          px: 1,
          py: 0.5,
          bgcolor: '#252525',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          minHeight: 40,
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

        <Chip
          label={session.serverProfile.name}
          size="small"
          color={session.serverProfile.color === 'default' || !session.serverProfile.color ? 'default' : session.serverProfile.color}
          variant="filled"
          sx={{ color: 'rgba(255, 255, 255, 0.9)' }}
        />

        <Typography
          variant="body2"
          sx={{ color: 'rgba(255, 255, 255, 0.7)', flexGrow: 1 }}
          noWrap
        >
          {session.name} - {session.serverProfile.username}@{session.serverProfile.hostname}
        </Typography>

        <Tooltip title="Copy terminal output">
          <IconButton
            size="small"
            onClick={handleCopyAll}
            sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
          >
            <CopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Download as text file">
          <IconButton
            size="small"
            onClick={handleDownload}
            sx={{ color: 'rgba(255, 255, 255, 0.7)' }}
          >
            <DownloadIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Terminal fills remaining space */}
      <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'hidden' }}>
        <TerminalView
          ref={terminalViewRef}
          sessionId={id}
          onConnectionChange={handleConnectionChange}
        />
      </Box>
    </Box>
  );
}
