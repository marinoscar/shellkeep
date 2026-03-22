import { useState, useEffect, FormEvent } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Alert,
  Box,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
} from '@mui/material';
import type { ServerProfile, ServerProfileFormData } from '../../types';

interface ServerProfileFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: ServerProfileFormData) => Promise<void>;
  profile?: ServerProfile | null;
}

const AUTH_METHOD_OPTIONS = [
  { value: 'password', label: 'Password' },
  { value: 'key', label: 'SSH Key' },
  { value: 'agent', label: 'SSH Agent' },
] as const;

export function ServerProfileForm({
  open,
  onClose,
  onSave,
  profile,
}: ServerProfileFormProps) {
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState<'password' | 'key' | 'agent'>(
    'password',
  );
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Track whether password fields have been modified during edit
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [privateKeyChanged, setPrivateKeyChanged] = useState(false);
  const [passphraseChanged, setPassphraseChanged] = useState(false);

  const isEditing = Boolean(profile);

  useEffect(() => {
    if (open) {
      if (profile) {
        setName(profile.name);
        setHostname(profile.hostname);
        setPort(profile.port);
        setUsername(profile.username);
        setAuthMethod(profile.authMethod);
        setPassword('');
        setPrivateKey('');
        setPassphrase('');
        setTags(profile.tags.join(', '));
        setPasswordChanged(false);
        setPrivateKeyChanged(false);
        setPassphraseChanged(false);
      } else {
        setName('');
        setHostname('');
        setPort(22);
        setUsername('');
        setAuthMethod('password');
        setPassword('');
        setPrivateKey('');
        setPassphrase('');
        setTags('');
        setPasswordChanged(false);
        setPrivateKeyChanged(false);
        setPassphraseChanged(false);
      }
      setError(null);
    }
  }, [open, profile]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!hostname.trim()) {
      setError('Hostname is required');
      return;
    }
    if (!username.trim()) {
      setError('Username is required');
      return;
    }

    const formData: ServerProfileFormData = {
      name: name.trim(),
      hostname: hostname.trim(),
      port,
      username: username.trim(),
      authMethod,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };

    // Only include credential fields if they were changed (or if creating new)
    if (authMethod === 'password') {
      if (!isEditing || passwordChanged) {
        formData.password = password;
      }
    } else if (authMethod === 'key') {
      if (!isEditing || privateKeyChanged) {
        formData.privateKey = privateKey;
      }
      if (!isEditing || passphraseChanged) {
        formData.passphrase = passphrase || undefined;
      }
    }

    setIsSubmitting(true);
    try {
      await onSave(formData);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>
          {isEditing ? 'Edit Server Profile' : 'Add Server Profile'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            <TextField
              label="Name"
              fullWidth
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
              sx={{ mb: 2 }}
              autoFocus
            />
            <TextField
              label="Hostname"
              fullWidth
              required
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              disabled={isSubmitting}
              sx={{ mb: 2 }}
            />
            <TextField
              label="Port"
              type="number"
              fullWidth
              value={port}
              onChange={(e) => setPort(parseInt(e.target.value, 10) || 22)}
              disabled={isSubmitting}
              sx={{ mb: 2 }}
              inputProps={{ min: 1, max: 65535 }}
            />
            <TextField
              label="Username"
              fullWidth
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isSubmitting}
              sx={{ mb: 2 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Auth Method</InputLabel>
              <Select
                value={authMethod}
                label="Auth Method"
                onChange={(e) =>
                  setAuthMethod(
                    e.target.value as 'password' | 'key' | 'agent',
                  )
                }
                disabled={isSubmitting}
              >
                {AUTH_METHOD_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {authMethod === 'password' && (
              <TextField
                label="Password"
                type="password"
                fullWidth
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordChanged(true);
                }}
                disabled={isSubmitting}
                sx={{ mb: 2 }}
                placeholder={
                  isEditing && profile?.hasPassword ? '••••••••' : undefined
                }
                helperText={
                  isEditing && profile?.hasPassword
                    ? 'Leave empty to keep current password'
                    : undefined
                }
              />
            )}

            {authMethod === 'key' && (
              <>
                <TextField
                  label="Private Key"
                  multiline
                  rows={4}
                  fullWidth
                  value={privateKey}
                  onChange={(e) => {
                    setPrivateKey(e.target.value);
                    setPrivateKeyChanged(true);
                  }}
                  disabled={isSubmitting}
                  sx={{ mb: 2 }}
                  placeholder={
                    isEditing && profile?.hasPrivateKey
                      ? '••••••••'
                      : 'Paste your private key here...'
                  }
                  helperText={
                    isEditing && profile?.hasPrivateKey
                      ? 'Leave empty to keep current key'
                      : undefined
                  }
                />
                <TextField
                  label="Passphrase"
                  type="password"
                  fullWidth
                  value={passphrase}
                  onChange={(e) => {
                    setPassphrase(e.target.value);
                    setPassphraseChanged(true);
                  }}
                  disabled={isSubmitting}
                  sx={{ mb: 2 }}
                  placeholder={
                    isEditing && profile?.hasPassphrase
                      ? '••••••••'
                      : undefined
                  }
                  helperText={
                    isEditing && profile?.hasPassphrase
                      ? 'Leave empty to keep current passphrase'
                      : undefined
                  }
                />
              </>
            )}

            <TextField
              label="Tags"
              fullWidth
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              disabled={isSubmitting}
              placeholder="e.g. production, web, database"
              helperText="Comma-separated list of tags"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : isEditing ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
