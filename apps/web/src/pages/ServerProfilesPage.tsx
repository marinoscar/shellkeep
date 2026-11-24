import { useState } from 'react';
import { Container, Typography, Box, IconButton, Snackbar, Alert } from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { ServerProfileList } from '../components/server-profiles/ServerProfileList';
import { ExportServersButton } from '../components/server-profiles/ExportServersButton';

interface SnackbarState {
  open: boolean;
  message: string;
  severity: 'success' | 'error' | 'info';
}

export default function ServerProfilesPage() {
  const navigate = useNavigate();
  const [snackbar, setSnackbar] = useState<SnackbarState>({
    open: false,
    message: '',
    severity: 'info',
  });

  const showSnackbar = (
    message: string,
    severity: 'success' | 'error' | 'info',
  ) => {
    setSnackbar({ open: true, message, severity });
  };

  const handleCloseSnackbar = () => {
    setSnackbar((prev) => ({ ...prev, open: false }));
  };

  const handleTestResult = (result: { success: boolean; error?: string }) => {
    if (result.success) {
      showSnackbar('Connection successful!', 'success');
    } else {
      showSnackbar(
        result.error || 'Connection failed',
        'error',
      );
    }
  };

  const handleDeleteSuccess = () => {
    showSnackbar('Server profile deleted', 'success');
  };

  const handleError = (message: string) => {
    showSnackbar(message, 'error');
  };

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <IconButton onClick={() => navigate('/')} aria-label="back to home">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h4" component="h1" sx={{ flexGrow: 1 }}>
            Server Profiles
          </Typography>
          {/* #68: the packaged export dialog preset to `server-profiles` (no credential is ever exported). */}
          <ExportServersButton
            onCreated={() =>
              showSnackbar('Export started. You will be notified when it is ready; find it under Settings, Download your data.', 'success')
            }
          />
        </Box>
        <Typography
          sx={{
            color: "text.secondary",
            ml: 6,
            mb: 2
          }}>
          Manage SSH server connections
        </Typography>

        <ServerProfileList
          onTestResult={handleTestResult}
          onDeleteSuccess={handleDeleteSuccess}
          onError={handleError}
        />
      </Box>

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
