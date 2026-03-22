import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Alert,
} from '@mui/material';
import type { ServerProfile, CreateSessionData } from '../../types';
import { getServerProfiles } from '../../services/api';

interface NewSessionDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: CreateSessionData) => Promise<void>;
}

export function NewSessionDialog({ open, onClose, onCreate }: NewSessionDialogProps) {
  const [serverProfiles, setServerProfiles] = useState<ServerProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setIsLoading(true);
      setError(null);
      getServerProfiles({ pageSize: 100 })
        .then((response) => {
          setServerProfiles(response.data);
          if (response.data.length > 0 && !selectedProfileId) {
            setSelectedProfileId(response.data[0].id);
          }
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : 'Failed to load server profiles');
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [open]);

  const handleCreate = async () => {
    if (!selectedProfileId) return;

    setIsCreating(true);
    setError(null);
    try {
      await onCreate({
        serverProfileId: selectedProfileId,
        name: sessionName.trim() || undefined,
      });
      // Reset form
      setSessionName('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (!isCreating) {
      setSessionName('');
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>New Terminal Session</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2, mt: 1 }}>
            {error}
          </Alert>
        )}

        {isLoading ? (
          <CircularProgress sx={{ display: 'block', mx: 'auto', my: 3 }} />
        ) : serverProfiles.length === 0 ? (
          <Alert severity="info" sx={{ mt: 1 }}>
            No server profiles found. Add a server profile first.
          </Alert>
        ) : (
          <>
            <FormControl fullWidth sx={{ mt: 1, mb: 2 }}>
              <InputLabel id="server-profile-label">Server Profile</InputLabel>
              <Select
                labelId="server-profile-label"
                value={selectedProfileId}
                label="Server Profile"
                onChange={(e) => setSelectedProfileId(e.target.value)}
              >
                {serverProfiles.map((profile) => (
                  <MenuItem key={profile.id} value={profile.id}>
                    {profile.name} ({profile.username}@{profile.hostname}:{profile.port})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              fullWidth
              label="Session Name (optional)"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="Auto-generated if empty"
              helperText="Give your session a descriptive name"
            />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={isCreating}>
          Cancel
        </Button>
        <Button
          onClick={handleCreate}
          variant="contained"
          disabled={isCreating || isLoading || !selectedProfileId || serverProfiles.length === 0}
          startIcon={isCreating ? <CircularProgress size={16} /> : undefined}
        >
          {isCreating ? 'Creating...' : 'Create Session'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
