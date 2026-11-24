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
  Chip,
  Typography,
  FormControlLabel,
  Switch,
} from '@mui/material';
import type { ServerProfile, ServerProfileFormData, ServerProfileColor } from '../../types';
import { HostKeySection } from './HostKeySection';
import { HostKeyStatusChip } from './HostKeyStatus';

interface ServerProfileFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: ServerProfileFormData) => Promise<void>;
  profile?: ServerProfile | null;
  /** Called after the host key or facts changed from the form's Host key section (#60). */
  onProfileChanged?: (profile: ServerProfile) => void;
}

/**
 * A profile shared with the viewer whose credentials someone else saved: its connection and secrets
 * are read-only here (the API refuses a change from anyone but the user who saved them, #71).
 */
function isConnectionLocked(profile: ServerProfile | null | undefined): boolean {
  return profile?.access?.credentialHolder === false;
}

const AUTH_METHOD_OPTIONS = [
  { value: 'password', label: 'Password' },
  { value: 'key', label: 'SSH Key' },
  { value: 'agent', label: 'SSH Agent' },
] as const;

const COLOR_OPTIONS: { value: ServerProfileColor; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
  { value: 'error', label: 'Red' },
  { value: 'warning', label: 'Orange' },
  { value: 'info', label: 'Blue' },
  { value: 'success', label: 'Green' },
];

export function ServerProfileForm({
  open,
  onClose,
  onSave,
  profile,
  onProfileChanged,
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
  const [color, setColor] = useState<ServerProfileColor>('default');
  const [aiOutputSharing, setAiOutputSharing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Track whether password fields have been modified during edit
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [privateKeyChanged, setPrivateKeyChanged] = useState(false);
  const [passphraseChanged, setPassphraseChanged] = useState(false);

  const isEditing = Boolean(profile);
  const connectionLocked = isConnectionLocked(profile);
  // A PATCH of the hostname or port clears the trusted host key (#60).
  const endpointChanged =
    !!profile?.fingerprint && (hostname.trim() !== profile.hostname || port !== profile.port);

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
        setColor(profile.color || 'default');
        setAiOutputSharing(profile.aiOutputSharing !== false);
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
        setColor('default');
        setAiOutputSharing(true);
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
      color,
      aiOutputSharing,
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
            {connectionLocked && (
              <Alert severity="info" sx={{ mb: 2 }} data-testid="connection-locked-note">
                This server is shared with you. Only the person who saved its credentials can change the connection or the
                secrets; you can change its name, tags, color and host-key trust.
              </Alert>
            )}
            <TextField
              label="Hostname"
              fullWidth
              required
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              disabled={isSubmitting || connectionLocked}
              sx={{ mb: 2 }}
            />
            <TextField
              label="Port"
              type="number"
              fullWidth
              value={port}
              onChange={(e) => setPort(parseInt(e.target.value, 10) || 22)}
              disabled={isSubmitting || connectionLocked}
              sx={{ mb: 2 }}
              helperText={
                endpointChanged
                  ? 'Changing the hostname or port forgets the trusted host key; the next connection asks you to verify it.'
                  : undefined
              }
              slotProps={{
                htmlInput: { min: 1, max: 65535 }
              }}
            />
            <TextField
              label="Username"
              fullWidth
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isSubmitting || connectionLocked}
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
                disabled={isSubmitting || connectionLocked}
              >
                {AUTH_METHOD_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {!connectionLocked && authMethod === 'password' && (
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

            {!connectionLocked && authMethod === 'key' && (
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
            <Box sx={{ mt: 2 }}>
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  mb: 1,
                  display: 'block'
                }}>
                Color Label
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {COLOR_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.value}
                    label={opt.label}
                    color={opt.value === 'default' ? 'default' : opt.value}
                    variant={color === opt.value ? 'filled' : 'outlined'}
                    onClick={() => setColor(opt.value)}
                    disabled={isSubmitting}
                  />
                ))}
              </Box>
            </Box>
            <Box sx={{ mt: 2 }} data-testid="ai-output-sharing">
              <FormControlLabel
                control={
                  <Switch
                    checked={aiOutputSharing}
                    onChange={(e) => setAiOutputSharing(e.target.checked)}
                    disabled={isSubmitting}
                    slotProps={{ input: { 'aria-describedby': 'ai-output-sharing-help' } }}
                  />
                }
                label="Send terminal output to AI"
              />
              <Typography
                id="ai-output-sharing-help"
                variant="body2"
                sx={{ color: 'text.secondary', mt: 0.5 }}
              >
                When on, AI features can read recent output from this server's terminals, with passwords, keys and tokens
                redacted first (best effort). Turn it off for servers that hold regulated or sensitive data: AI then sees
                only the operating system, shell and current directory, and cannot explain or summarize this server's output.
              </Typography>
            </Box>
            {profile ? (
              <HostKeySection profile={profile} onProfileChanged={onProfileChanged} />
            ) : (
              <Box sx={{ mt: 3 }} data-testid="host-key-section-new">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="subtitle1" component="h3">
                    Host key
                  </Typography>
                  <HostKeyStatusChip profile={null} />
                </Box>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Verified on the first connection or test: you compare the fingerprint and trust it.
                </Typography>
              </Box>
            )}
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
