/**
 * "Run runbook on selected…" (#79): pick a runbook, see exactly the servers it will target, and
 * either preview them (dry run: `POST /api/runbooks/targets/preview`, nothing runs) or start the
 * run (`POST /api/runbooks/:id/runs` with `targets: { serverIds }`, the runbook engine's route, #62).
 * The page shows this action only to a caller with `runbooks:run`; the API decides each target.
 */

import { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import type { ServerProfile } from '../../types';
import {
  listRunbooks,
  previewRunbookTargets,
  startRunbookRun,
  type RunbookSummary,
  type RunbookTargetsPreview,
} from '../../services/runbooks-api';

/**
 * Whether the run route is served. False until the runbook engine (#62) is on main: the dialog
 * still opens, previews the targets (dry run) and explains why a real run is not offered.
 */
export const RUNBOOK_RUNS_AVAILABLE = false;
export const RUNBOOK_RUNS_UNAVAILABLE_REASON = 'Runbook runs arrive with #62';

export interface RunRunbookDialogProps {
  open: boolean;
  profiles: ServerProfile[];
  onClose: () => void;
  /** Called with the new run id after a real run started. */
  onStarted?: (runId: string) => void;
  /** Overrides {@link RUNBOOK_RUNS_AVAILABLE} (tests). */
  runsAvailable?: boolean;
}

export function RunRunbookDialog({
  open,
  profiles,
  onClose,
  onStarted,
  runsAvailable = RUNBOOK_RUNS_AVAILABLE,
}: RunRunbookDialogProps) {
  const [runbooks, setRunbooks] = useState<RunbookSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runbook, setRunbook] = useState<RunbookSummary | null>(null);
  const [dryRun, setDryRun] = useState(!runsAvailable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RunbookTargetsPreview | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRunbook(null);
    setDryRun(!runsAvailable);
    setError(null);
    setPreview(null);
    setRunId(null);
    setLoadError(null);
    let cancelled = false;
    listRunbooks()
      .then((page) => !cancelled && setRunbooks(page?.items ?? []))
      .catch((err: unknown) => !cancelled && setLoadError(err instanceof Error ? err.message : 'Could not load the runbooks'));
    return () => {
      cancelled = true;
    };
  }, [open, runsAvailable]);

  const serverIds = profiles.map((profile) => profile.id);
  const nameOf = (id: string) => profiles.find((profile) => profile.id === id)?.name ?? id;

  const submit = async () => {
    if (!runbook) return;
    setBusy(true);
    setError(null);
    try {
      if (dryRun) {
        setPreview(await previewRunbookTargets(serverIds));
      } else {
        const started = await startRunbookRun(runbook.id, serverIds);
        setRunId(started.runId);
        onStarted?.(started.runId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The request failed');
    } finally {
      setBusy(false);
    }
  };

  const startBlocked = !dryRun && !runsAvailable;
  const action = (
    <Button
      variant="contained"
      onClick={() => void submit()}
      disabled={!runbook || busy || startBlocked || !!runId}
      data-testid="run-runbook-submit"
    >
      {dryRun ? 'Preview targets' : `Run on ${profiles.length} ${profiles.length === 1 ? 'server' : 'servers'}`}
    </Button>
  );

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="run-runbook-title">
      <DialogTitle id="run-runbook-title">Run runbook on selected</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1 }} data-testid="run-runbook-target-count">
          {profiles.length} {profiles.length === 1 ? 'target' : 'targets'}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }} data-testid="run-runbook-targets">
          {profiles.map((profile) => (
            <Chip key={profile.id} size="small" label={profile.name} data-server-id={profile.id} />
          ))}
        </Box>
        {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}
        <Autocomplete
          options={runbooks}
          value={runbook}
          onChange={(_, next) => {
            setRunbook(next);
            setPreview(null);
          }}
          getOptionLabel={(option) => option.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          noOptionsText="No runbooks you may run"
          renderInput={(params) => <TextField {...params} label="Runbook" />}
        />
        <Tooltip title={runsAvailable ? '' : RUNBOOK_RUNS_UNAVAILABLE_REASON}>
          <FormControlLabel
            sx={{ mt: 1 }}
            control={
              <Switch
                checked={dryRun}
                onChange={(event) => setDryRun(event.target.checked)}
                disabled={!runsAvailable}
                slotProps={{ input: { 'aria-label': 'Dry run' } }}
              />
            }
            label="Dry run: show which servers the run would reach, run nothing"
          />
        </Tooltip>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        {preview && (
          <Box sx={{ mt: 2 }} data-testid="run-runbook-preview">
            <Alert severity={preview.skipped.length ? 'warning' : 'success'}>
              The run would reach {preview.servers.length} of {profiles.length} servers
              {preview.skipped.length ? `; ${preview.skipped.length} would be skipped` : ''}.
            </Alert>
            {preview.skipped.length > 0 && (
              <List dense aria-label="Skipped servers">
                {preview.skipped.map((skip) => (
                  <ListItem key={skip.serverProfileId} disableGutters>
                    <ListItemText primary={nameOf(skip.serverProfileId)} secondary={skip.reason} />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        )}
        {runId && (
          <Alert severity="success" sx={{ mt: 2 }} data-testid="run-runbook-started">
            Run started ({runId}).
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {runId ? 'Close' : 'Cancel'}
        </Button>
        {startBlocked ? (
          <Tooltip title={RUNBOOK_RUNS_UNAVAILABLE_REASON}>
            <span>{action}</span>
          </Tooltip>
        ) : (
          action
        )}
      </DialogActions>
    </Dialog>
  );
}
