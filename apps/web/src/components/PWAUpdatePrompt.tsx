import { useRegisterSW } from 'virtual:pwa-register/react';
import Snackbar from '@mui/material/Snackbar';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';

export function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  const handleUpdate = () => {
    updateServiceWorker(true);
  };

  const handleDismiss = () => {
    setNeedRefresh(false);
  };

  return (
    <Snackbar
      open={needRefresh}
      message="A new version of ShellKeep is available."
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      action={
        <Stack direction="row" spacing={1}>
          <Button color="primary" size="small" variant="contained" onClick={handleUpdate}>
            Update
          </Button>
          <Button color="inherit" size="small" onClick={handleDismiss}>
            Later
          </Button>
        </Stack>
      }
    />
  );
}
