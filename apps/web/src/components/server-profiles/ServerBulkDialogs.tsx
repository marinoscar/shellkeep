/**
 * The bulk actions of the Servers page (#79), each on the selected profiles:
 *
 * - `BulkTestDialog`   tests each connection, client-side, at most 4 in flight, with a progress list
 * - `BulkTagDialog`    adds or removes one tag (`PATCH /server-profiles/bulk-tags`) and reports the
 *                      profiles the caller may not change
 * - `BulkDeleteDialog` confirms with the count, deletes at most 4 at a time and reports what it
 *                      could not delete
 *
 * The API decides every call; the `access.can` flags only spare the caller a call that would be refused.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  Block as SkippedIcon,
  CheckCircle as OkIcon,
  ErrorOutlined as FailedIcon,
  HourglassEmpty as PendingIcon,
  GppMaybe as HostKeyIcon,
} from '@mui/icons-material';
import type { ServerProfile } from '../../types';
import { bulkTagServerProfiles, deleteServerProfile, testServerProfile } from '../../services/terminal-api';
import { runPool } from '../../lib/servers/runPool';
import { TagsInput } from './TagsInput';

/** At most this many bulk calls in flight. */
export const BULK_CONCURRENCY = 4;

type ItemState = 'pending' | 'running' | 'ok' | 'failed' | 'hostkey' | 'skipped';

const STATE_TEXT: Record<ItemState, string> = {
  pending: 'Waiting',
  running: 'Running…',
  ok: 'Done',
  failed: 'Failed',
  hostkey: 'Host key needs verifying',
  skipped: 'Not allowed',
};

function StateIcon({ state }: { state: ItemState }) {
  if (state === 'ok') return <OkIcon color="success" fontSize="small" aria-hidden />;
  if (state === 'failed') return <FailedIcon color="error" fontSize="small" aria-hidden />;
  if (state === 'hostkey') return <HostKeyIcon color="warning" fontSize="small" aria-hidden />;
  if (state === 'skipped') return <SkippedIcon fontSize="small" sx={{ color: 'text.secondary' }} aria-hidden />;
  return <PendingIcon fontSize="small" sx={{ color: 'text.secondary' }} aria-hidden />;
}

interface Progress {
  state: ItemState;
  detail?: string;
}

function ProgressList({ profiles, progress }: { profiles: ServerProfile[]; progress: Record<string, Progress> }) {
  return (
    <List dense aria-label="Progress" sx={{ maxHeight: 320, overflowY: 'auto' }}>
      {profiles.map((profile) => {
        const item = progress[profile.id] ?? { state: 'pending' as const };
        return (
          <ListItem key={profile.id} data-testid={`bulk-item-${profile.id}`} data-state={item.state} disableGutters>
            <ListItemIcon sx={{ minWidth: 32 }}>
              <StateIcon state={item.state} />
            </ListItemIcon>
            <ListItemText
              primary={profile.name}
              secondary={item.detail ? `${STATE_TEXT[item.state]}: ${item.detail}` : STATE_TEXT[item.state]}
              slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } }, secondary: { sx: { overflowWrap: 'anywhere' } } }}
            />
          </ListItem>
        );
      })}
    </List>
  );
}

const can = (profile: ServerProfile, action: 'test' | 'write' | 'delete') => (profile.access ? profile.access.can[action] : true);

/** The settled count of a progress map. */
const settled = (progress: Record<string, Progress>) =>
  Object.values(progress).filter((item) => item.state !== 'pending' && item.state !== 'running').length;

// ---------------------------------------------------------------------------

export interface BulkDialogProps {
  open: boolean;
  profiles: ServerProfile[];
  onClose: () => void;
  /** Called once the action finished, so the page reloads the rows it changed. */
  onDone: () => void;
}

export function BulkTestDialog({ open, profiles, onClose, onDone }: BulkDialogProps) {
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [running, setRunning] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!open) {
      started.current = false;
      return;
    }
    if (started.current) return;
    started.current = true;
    const initial: Record<string, Progress> = {};
    for (const profile of profiles) initial[profile.id] = { state: can(profile, 'test') ? 'pending' : 'skipped' };
    setProgress(initial);
    setRunning(true);
    const testable = profiles.filter((profile) => can(profile, 'test'));
    void runPool(
      testable,
      BULK_CONCURRENCY,
      async (profile) => {
        setProgress((prev) => ({ ...prev, [profile.id]: { state: 'running' } }));
        return testServerProfile(profile.id);
      },
      (profile, outcome) => {
        let next: Progress;
        if (!outcome.ok) {
          next = { state: 'failed', detail: outcome.error instanceof Error ? outcome.error.message : 'Request failed' };
        } else if (outcome.value.code) {
          next = { state: 'hostkey', detail: outcome.value.code === 'HOST_KEY_MISMATCH' ? 'the key changed' : 'not trusted yet' };
        } else if (outcome.value.success) {
          next = { state: 'ok' };
        } else {
          next = { state: 'failed', detail: outcome.value.error };
        }
        setProgress((prev) => ({ ...prev, [profile.id]: next }));
      },
    ).finally(() => {
      setRunning(false);
      onDone();
    });
    // Runs once per opening, over the selection it opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const done = settled(progress);
  return (
    <Dialog open={open} onClose={running ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Test connection on {profiles.length} servers</DialogTitle>
      <DialogContent>
        <LinearProgress
          variant="determinate"
          value={profiles.length ? (done / profiles.length) * 100 : 100}
          aria-label="Tested"
          sx={{ mb: 1 }}
        />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {done} of {profiles.length} finished · at most {BULK_CONCURRENCY} at a time
        </Typography>
        <ProgressList profiles={profiles} progress={progress} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          A server whose host key needs verifying is not logged into; open it to verify the key.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={running}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function BulkTagDialog({
  open,
  profiles,
  onClose,
  onDone,
  tagOptions,
}: BulkDialogProps & { tagOptions: readonly string[] }) {
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ updated: number; unchanged: number; denied: string[] } | null>(null);

  useEffect(() => {
    if (open) {
      setTags([]);
      setMode('add');
      setError(null);
      setResult(null);
    }
  }, [open]);

  const nameOf = (id: string) => profiles.find((profile) => profile.id === id)?.name ?? id;

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await bulkTagServerProfiles({
        ids: profiles.map((profile) => profile.id),
        ...(mode === 'add' ? { add: tags } : { remove: tags }),
      });
      setResult({ updated: res.updated.length, unchanged: res.unchanged.length, denied: res.denied });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the tags');
    } finally {
      setBusy(false);
    }
  };

  // Removing offers only the tags the selection carries.
  const options = mode === 'remove' ? [...new Set(profiles.flatMap((profile) => profile.tags))].sort() : tagOptions;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Tags on {profiles.length} servers</DialogTitle>
      <DialogContent>
        {result ? (
          <Box data-testid="bulk-tag-result">
            <Alert severity={result.denied.length ? 'warning' : 'success'} sx={{ mb: 1 }}>
              {result.updated} changed, {result.unchanged} already as asked
              {result.denied.length ? `, ${result.denied.length} you cannot change` : ''}.
            </Alert>
            {result.denied.length > 0 && (
              <List dense aria-label="Servers you cannot change">
                {result.denied.map((id) => (
                  <ListItem key={id} disableGutters>
                    <ListItemText primary={nameOf(id)} />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        ) : (
          <>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={mode}
              onChange={(_, value) => value && setMode(value)}
              aria-label="Add or remove"
              sx={{ mb: 2 }}
            >
              <ToggleButton value="add">Add</ToggleButton>
              <ToggleButton value="remove">Remove</ToggleButton>
            </ToggleButtonGroup>
            <TagsInput value={tags} onChange={setTags} options={options} label={mode === 'add' ? 'Tags to add' : 'Tags to remove'} disabled={busy} />
            {error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {error}
              </Alert>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {result ? 'Close' : 'Cancel'}
        </Button>
        {!result && (
          <Button variant="contained" onClick={() => void apply()} disabled={busy || tags.length === 0}>
            {mode === 'add' ? 'Add tags' : 'Remove tags'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function BulkDeleteDialog({ open, profiles, onClose, onDone }: BulkDialogProps) {
  const [progress, setProgress] = useState<Record<string, Progress> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setProgress(null);
  }, [open]);

  const deletable = profiles.filter((profile) => can(profile, 'delete'));
  const refused = profiles.filter((profile) => !can(profile, 'delete'));

  const run = async () => {
    setBusy(true);
    const initial: Record<string, Progress> = {};
    for (const profile of profiles) initial[profile.id] = { state: can(profile, 'delete') ? 'pending' : 'skipped' };
    setProgress(initial);
    await runPool(
      deletable,
      BULK_CONCURRENCY,
      async (profile) => {
        setProgress((prev) => ({ ...prev, [profile.id]: { state: 'running' } }));
        await deleteServerProfile(profile.id);
      },
      (profile, outcome) =>
        setProgress((prev) => ({
          ...prev,
          [profile.id]: outcome.ok
            ? { state: 'ok' }
            : { state: 'failed', detail: outcome.error instanceof Error ? outcome.error.message : 'Request failed' },
        })),
    );
    setBusy(false);
    onDone();
  };

  const failed = progress ? profiles.filter((profile) => ['failed', 'skipped'].includes(progress[profile.id]?.state)) : [];

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        Delete {deletable.length} {deletable.length === 1 ? 'server' : 'servers'}?
      </DialogTitle>
      <DialogContent>
        {progress ? (
          <>
            {!busy && (
              <Alert severity={failed.length ? 'warning' : 'success'} sx={{ mb: 1 }} data-testid="bulk-delete-result">
                {profiles.length - failed.length} deleted{failed.length ? `, ${failed.length} not deleted` : ''}.
              </Alert>
            )}
            <ProgressList profiles={profiles} progress={progress} />
          </>
        ) : (
          <>
            <DialogContentText>
              This deletes the {deletable.length} selected server {deletable.length === 1 ? 'profile' : 'profiles'}, their
              stored credentials and their shares. Sessions on them end. This cannot be undone.
            </DialogContentText>
            {refused.length > 0 && (
              <Alert severity="info" sx={{ mt: 2 }} data-testid="bulk-delete-refused">
                You cannot delete {refused.length} of the selected servers (only their owner can):{' '}
                {refused.map((profile) => profile.name).join(', ')}.
              </Alert>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {progress ? 'Close' : 'Cancel'}
        </Button>
        {!progress && (
          <Button color="error" variant="contained" onClick={() => void run()} disabled={deletable.length === 0}>
            Delete {deletable.length}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
