/**
 * The upload queue's UI (issue #157): one row per file with a progress bar and
 * Cancel, a polite live region for the transitions, and the Replace or Skip
 * dialog for a file that already exists. Presentational: `useFileUploads` owns
 * the state. It reads no breakpoint.
 */
import { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Typography,
} from '@mui/material';
import { Close as CancelIcon } from '@mui/icons-material';
import { formatSize } from '../../../lib/files/viewer/text';
import { relativeTime } from '../../../lib/servers/relativeTime';
import {
  isActiveUpload,
  type ConflictDecision,
  type UploadConflict,
  type UploadItem,
} from './useFileUploads';

export interface UploadPanelProps {
  items: UploadItem[];
  announcement: string;
  conflict: UploadConflict | null;
  onCancel: (id: number) => void;
  onClearFinished: () => void;
  onResolveConflict: (decision: ConflictDecision, remember: boolean) => void;
}

const STATUS_TEXT: Record<UploadItem['status'], string> = {
  queued: 'Waiting',
  uploading: 'Uploading',
  waiting: 'Waiting for your choice',
  done: 'Uploaded',
  skipped: 'Skipped',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function percent(item: UploadItem): number {
  if (item.status === 'done') return 100;
  if (item.size <= 0) return item.status === 'uploading' ? 0 : 0;
  return Math.min(100, Math.round((item.loaded / item.size) * 100));
}

function ConflictDialog({
  conflict,
  onResolve,
}: {
  conflict: UploadConflict;
  onResolve: (decision: ConflictDecision, remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  const { item, existing } = conflict;
  const facts = [
    typeof existing.size === 'number' ? formatSize(existing.size) : null,
    existing.mtime ? `modified ${relativeTime(existing.mtime)}` : null,
  ].filter(Boolean);
  return (
    <Dialog open aria-labelledby="upload-conflict-title" onClose={() => onResolve('skip', false)}>
      <DialogTitle id="upload-conflict-title">Replace existing file?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {`"${item.name}" already exists in ${item.dir}${facts.length ? ` (${facts.join(', ')})` : ''}. Replace it with the file you chose (${formatSize(item.size)})?`}
        </DialogContentText>
        <FormControlLabel
          control={<Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} />}
          label="Apply to all"
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onResolve('skip', remember)}>Skip</Button>
        <Button variant="contained" onClick={() => onResolve('replace', remember)} autoFocus>
          Replace
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function UploadPanel({ items, announcement, conflict, onCancel, onClearFinished, onResolveConflict }: UploadPanelProps) {
  const finished = items.some((item) => !isActiveUpload(item));
  return (
    <>
      {/* Transitions are spoken here; the per-file progress bars carry the numbers. */}
      <Box role="status" aria-live="polite" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {announcement}
      </Box>
      {items.length > 0 && (
        <Box
          role="region"
          aria-label="Uploads"
          data-testid="upload-panel"
          sx={{ flexShrink: 0, maxHeight: '40%', overflowY: 'auto', borderTop: 1, borderColor: 'divider', px: 1.5, py: 1 }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="subtitle2">Uploads</Typography>
            {finished && (
              <Button size="small" onClick={onClearFinished}>
                Clear finished
              </Button>
            )}
          </Box>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1 }}>
            {items.map((item) => {
              const active = isActiveUpload(item);
              return (
                <Box component="li" key={item.id} sx={{ minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }} title={item.name}>
                      {item.name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: item.status === 'failed' ? 'error.main' : 'text.secondary', flexShrink: 0 }}>
                      {item.status === 'uploading' ? `${percent(item)}%` : STATUS_TEXT[item.status]}
                    </Typography>
                    {active && (
                      <IconButton size="small" aria-label={`Cancel upload of ${item.name}`} onClick={() => onCancel(item.id)}>
                        <CancelIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Box>
                  {(item.status === 'uploading' || item.status === 'queued' || item.status === 'waiting') && (
                    <LinearProgress
                      variant={item.status === 'uploading' ? 'determinate' : 'indeterminate'}
                      value={percent(item)}
                      aria-label={`Uploading ${item.name}`}
                      {...(item.status === 'uploading' ? { 'aria-valuetext': `${percent(item)} percent of ${formatSize(item.size)}` } : {})}
                      sx={item.status === 'uploading' ? undefined : { opacity: 0.4 }}
                    />
                  )}
                  {item.status === 'failed' && item.message && (
                    <Typography variant="caption" sx={{ color: 'error.main', display: 'block' }}>
                      {item.message}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
      {conflict && <ConflictDialog conflict={conflict} onResolve={onResolveConflict} />}
    </>
  );
}
