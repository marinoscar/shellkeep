import { useState, useCallback } from 'react';
import {
  Container,
  Typography,
  Box,
  Grid,
  Tabs,
  Tab,
  Button,
  IconButton,
  Snackbar,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import { Add as AddIcon, ArrowBack as ArrowBackIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useSessions } from '../hooks/useSessions';
import { SessionCard } from '../components/terminal/SessionCard';
import { NewSessionDialog } from '../components/terminal/NewSessionDialog';
import type { TerminalSession, CreateSessionData } from '../types';

interface SnackbarState {
  open: boolean;
  message: string;
  severity: 'success' | 'error' | 'info';
}

const STATUS_TABS = ['all', 'active', 'detached', 'terminated'] as const;

export default function SessionsPage() {
  const navigate = useNavigate();
  const {
    sessions,
    isLoading,
    statusFilter,
    setStatusFilter,
    createNewSession,
    renameSession,
    terminateSession,
    batchTerminate,
  } = useSessions();

  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<TerminalSession | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [snackbar, setSnackbar] = useState<SnackbarState>({
    open: false,
    message: '',
    severity: 'info',
  });

  const showSnackbar = (message: string, severity: 'success' | 'error' | 'info') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleCloseSnackbar = () => {
    setSnackbar((prev) => ({ ...prev, open: false }));
  };

  const handleSelectToggle = useCallback((session: TerminalSession) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(session.id)) {
        next.delete(session.id);
      } else {
        next.add(session.id);
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setStatusFilter(STATUS_TABS[newValue]);
    setSelectedIds(new Set());
  };

  const handleOpenSession = useCallback(
    (session: TerminalSession) => {
      navigate(`/sessions/${session.id}/terminal`);
    },
    [navigate],
  );

  const handleRenameClick = useCallback((session: TerminalSession) => {
    setSelectedSession(session);
    setRenameValue(session.name);
    setRenameDialogOpen(true);
  }, []);

  const handleRenameConfirm = async () => {
    if (!selectedSession || !renameValue.trim()) return;
    try {
      await renameSession(selectedSession.id, renameValue.trim());
      showSnackbar('Session renamed', 'success');
    } catch {
      showSnackbar('Failed to rename session', 'error');
    }
    setRenameDialogOpen(false);
    setSelectedSession(null);
  };

  const handleTerminate = useCallback(
    async (session: TerminalSession) => {
      try {
        await terminateSession(session.id);
        showSnackbar('Session terminated', 'success');
      } catch {
        showSnackbar('Failed to terminate session', 'error');
      }
    },
    [terminateSession],
  );

  const handleBatchTerminate = async () => {
    setConfirmDialogOpen(false);
    try {
      const result = await batchTerminate(Array.from(selectedIds));
      showSnackbar(`${result.terminated} session${result.terminated !== 1 ? 's' : ''} terminated`, 'success');
      setSelectedIds(new Set());
    } catch {
      showSnackbar('Failed to terminate sessions', 'error');
    }
  };

  const handleCreateSession = async (data: CreateSessionData) => {
    const session = await createNewSession(data);
    showSnackbar('Session created', 'success');
    navigate(`/sessions/${session.id}/terminal`);
  };

  const currentTabIndex = STATUS_TABS.indexOf(statusFilter as typeof STATUS_TABS[number]);

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <IconButton onClick={() => navigate('/')} aria-label="back to home">
                <ArrowBackIcon />
              </IconButton>
              <Typography variant="h4" component="h1">
                Terminal Sessions
              </Typography>
            </Box>
            <Typography color="text.secondary" sx={{ ml: 6 }}>
              Manage your SSH terminal sessions
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setNewDialogOpen(true)}
          >
            New Session
          </Button>
        </Box>

        <Tabs
          value={currentTabIndex >= 0 ? currentTabIndex : 0}
          onChange={handleTabChange}
          sx={{ mb: 3 }}
        >
          <Tab label="All" />
          <Tab label="Active" />
          <Tab label="Detached" />
          <Tab label="Terminated" />
        </Tabs>

        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          Sessions inactive for 1 hour are automatically marked as detached. Detached sessions inactive for 12 hours are terminated. Terminated sessions are permanently removed after 30 days.
        </Alert>

        {selectedIds.size > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, p: 1.5, bgcolor: 'action.selected', borderRadius: 1 }}>
            <Typography variant="body2" sx={{ flexGrow: 1 }}>
              {selectedIds.size} session{selectedIds.size > 1 ? 's' : ''} selected
            </Typography>
            <Button size="small" onClick={handleClearSelection}>
              Clear
            </Button>
            <Button
              variant="contained"
              color="error"
              size="small"
              startIcon={<DeleteIcon />}
              onClick={() => setConfirmDialogOpen(true)}
            >
              Terminate Selected
            </Button>
          </Box>
        )}

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : sessions.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No sessions found
            </Typography>
            <Typography color="text.secondary" paragraph>
              {statusFilter === 'all'
                ? 'Create your first terminal session to get started.'
                : `No ${statusFilter} sessions.`}
            </Typography>
            {statusFilter === 'all' && (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setNewDialogOpen(true)}
              >
                New Session
              </Button>
            )}
          </Box>
        ) : (
          <Grid container spacing={2}>
            {sessions.map((session) => (
              <Grid item xs={12} sm={6} md={4} key={session.id}>
                <SessionCard
                  session={session}
                  onOpen={handleOpenSession}
                  onRename={handleRenameClick}
                  onTerminate={handleTerminate}
                  selected={selectedIds.has(session.id)}
                  onSelectToggle={handleSelectToggle}
                />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>

      {/* New Session Dialog */}
      <NewSessionDialog
        open={newDialogOpen}
        onClose={() => setNewDialogOpen(false)}
        onCreate={handleCreateSession}
      />

      {/* Rename Dialog */}
      <Dialog
        open={renameDialogOpen}
        onClose={() => setRenameDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Rename Session</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Session Name"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameConfirm();
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleRenameConfirm}
            variant="contained"
            disabled={!renameValue.trim()}
          >
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      {/* Batch Terminate Confirmation Dialog */}
      <Dialog
        open={confirmDialogOpen}
        onClose={() => setConfirmDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Terminate Sessions</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to terminate {selectedIds.size} session{selectedIds.size !== 1 ? 's' : ''}? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleBatchTerminate} variant="contained" color="error">
            Terminate
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={handleCloseSnackbar}
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
}
