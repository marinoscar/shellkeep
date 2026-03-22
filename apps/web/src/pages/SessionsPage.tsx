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
import { Add as AddIcon, ArrowBack as ArrowBackIcon } from '@mui/icons-material';
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
  } = useSessions();

  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
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

  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setStatusFilter(STATUS_TABS[newValue]);
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
