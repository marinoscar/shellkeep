/**
 * The share-by-link dialog of a run's log bundle (#63): link mode only. A run is never granted to a person or a
 * group (the API lists `viewer` for links and nothing else for `runbook_run`), so this is the packaged link
 * section (`useLinkGrants`) without the people section of `ShareDialog`: an expiry picker (7 days by default,
 * 30 at most, as the API caps it), the copyable URL, the active links and Revoke.
 *
 * The URL carries the token in its fragment; it is shown in a field and copied, never logged or stored.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useLinkGrants } from '@marinoscar/platform-web/sharing/headless';

export const RUN_LINK_PRESETS = [
  { label: '1 day', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
] as const;

export interface RunLinkDialogProps {
  open: boolean;
  onClose: () => void;
  runId: string;
  title?: string;
}

export function RunLinkDialog({ open, onClose, runId, title }: RunLinkDialogProps) {
  const links = useLinkGrants({ type: 'runbook_run', id: runId }, { enabled: open });
  const [preset, setPreset] = useState(1);
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    setCopied(null);
    try {
      const days = RUN_LINK_PRESETS[preset]!.days;
      const result = await links.create({ role: 'viewer', expiresAt: new Date(Date.now() + days * 86_400_000).toISOString() });
      setIssued(result.url);
      await links.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The link could not be created');
    }
  };

  const copy = async (url: string) => setCopied((await links.copyUrl(url)) ? 'yes' : 'no');

  const items = links.data ?? [];

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="run-link-title">
      <DialogTitle id="run-link-title">{title ? `Share the logs of "${title}"` : 'Share the logs'}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Anyone with the link can download the log bundle of this run without signing in, until the link expires or you
          revoke it. The bundle can contain sensitive output: share it only with people you trust.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, mb: 2 }}>
          <TextField
            select
            size="small"
            label="Link expires"
            value={String(preset)}
            onChange={(event) => setPreset(Number(event.target.value))}
            sx={{ minWidth: 150 }}
          >
            {RUN_LINK_PRESETS.map((option, index) => (
              <MenuItem key={option.label} value={String(index)}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <Button variant="outlined" onClick={() => void create()} disabled={links.pending}>
            Create link
          </Button>
        </Stack>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} data-testid="run-link-error">
            {error}
          </Alert>
        )}
        {issued && (
          <Stack spacing={1} sx={{ mb: 2 }}>
            <TextField
              label="Share link"
              value={issued}
              size="small"
              fullWidth
              onFocus={(event) => event.target.select()}
              slotProps={{ input: { readOnly: true } }}
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Button size="small" onClick={() => void copy(issued)}>
                Copy link
              </Button>
              {copied === 'yes' && <Typography variant="caption">Copied</Typography>}
              {copied === 'no' && <Typography variant="caption">Copy it by hand: select the field above.</Typography>}
            </Stack>
          </Stack>
        )}
        <Typography variant="subtitle2" component="h3" gutterBottom>
          Active links
        </Typography>
        {links.error ? (
          <Alert severity="error">{links.error.message}</Alert>
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No active links.
          </Typography>
        ) : (
          <List dense aria-label="Active links">
            {items.map((link) => (
              <ListItem key={link.id} disableGutters secondaryAction={
                <Button size="small" color="error" onClick={() => void links.revoke(link.id).then(() => links.refresh())}>
                  Revoke
                </Button>
              }>
                <Typography variant="body2">
                  {link.expiresAt ? `Expires ${new Date(link.expiresAt).toLocaleString()}` : 'Never expires'}
                </Typography>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
