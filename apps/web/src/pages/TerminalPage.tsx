import { useState, useCallback, useEffect, useRef } from 'react';
import { Box, IconButton, Tooltip, Snackbar, Alert } from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { TerminalView } from '../components/terminal/TerminalView';
import type { TerminalViewHandle } from '../components/terminal/TerminalView';
import { TerminalToolbar } from '../components/terminal/TerminalToolbar';
import { NewSessionDialog } from '../components/terminal/NewSessionDialog';
import { getSession, updateSession, uploadFile, getDownloadUrl, createSession, downloadSessionHistory } from '../services/api';
import type { TerminalSession, CreateSessionData } from '../types';

export default function TerminalPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const terminalViewRef = useRef<TerminalViewHandle>(null);
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' | 'warning' }>({ open: false, message: '', severity: 'info' });
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

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

  const getTerminalText = useCallback((): string => {
    const terminal = terminalViewRef.current?.getTerminal();
    if (!terminal) return '';
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    // Trim trailing empty lines
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

  const handleDownload = useCallback(async () => {
    if (!id) return;
    setIsDownloading(true);
    try {
      const blob = await downloadSessionHistory(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${session?.name || 'terminal'}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Fallback to local xterm.js buffer
      const text = getTerminalText();
      if (text) {
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${session?.name || 'terminal'}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      }
      setSnackbar({ open: true, message: 'Full history unavailable, downloaded local buffer', severity: 'warning' });
    } finally {
      setIsDownloading(false);
    }
  }, [id, session?.name, getTerminalText]);

  const handlePaste = useCallback(async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        // Check for text first
        if (item.types.includes('text/plain')) {
          const blob = await item.getType('text/plain');
          const text = await blob.text();
          if (text) {
            terminalViewRef.current?.sendInput(text);
            terminalViewRef.current?.focus();
            return;
          }
        }
        // Check for image types
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          setSnackbar({ open: true, message: 'Uploading image...', severity: 'info' });
          const blob = await item.getType(imageType);
          const ext = imageType.split('/')[1] || 'png';
          const { id: objId } = await uploadFile(blob, `clipboard-${Date.now()}.${ext}`);
          const url = await getDownloadUrl(objId, 3600);
          terminalViewRef.current?.sendInput(url);
          terminalViewRef.current?.focus();
          setSnackbar({ open: true, message: 'Image uploaded and URL pasted', severity: 'success' });
          return;
        }
      }
      setSnackbar({ open: true, message: 'Only text and images can be pasted', severity: 'warning' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to paste from clipboard';
      setSnackbar({ open: true, message, severity: 'error' });
    }
  }, []);

  const handleCreateNewSession = useCallback(async (data: CreateSessionData) => {
    const newSession = await createSession(data);
    window.open(`/terminal/${newSession.id}`, '_blank');
  }, []);

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
      <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, position: 'sticky', top: 0, zIndex: 10, bgcolor: 'background.default' }}>
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
            onCopyAll={handleCopyAll}
            onDownload={handleDownload}
            isDownloading={isDownloading}
            onPaste={handlePaste}
            onNewSession={() => setNewSessionDialogOpen(true)}
            serverProfileName={session.serverProfile.name}
            serverProfileColor={session.serverProfile.color}
          />
        </Box>
      </Box>

      {/* Terminal */}
      <Box sx={{ flexGrow: 1, minHeight: 0 }}>
        <TerminalView
          ref={terminalViewRef}
          sessionId={id}
          onConnectionChange={handleConnectionChange}
        />
      </Box>

      <NewSessionDialog
        open={newSessionDialogOpen}
        onClose={() => setNewSessionDialogOpen(false)}
        onCreate={handleCreateNewSession}
      />
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar(s => ({ ...s, open: false }))}
          severity={snackbar.severity}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
