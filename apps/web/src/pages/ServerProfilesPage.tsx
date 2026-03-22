import { useState } from 'react';
import { Container, Typography, Box, Snackbar, Alert } from '@mui/material';
import { ServerProfileList } from '../components/server-profiles/ServerProfileList';

interface SnackbarState {
  open: boolean;
  message: string;
  severity: 'success' | 'error' | 'info';
}

export default function ServerProfilesPage() {
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
        <Typography variant="h4" component="h1" gutterBottom>
          Server Profiles
        </Typography>
        <Typography color="text.secondary" paragraph>
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
