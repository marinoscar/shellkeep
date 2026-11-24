/**
 * The folder archives' UI (issue #158): one row per "Download as archive" request with a pending state, a
 * Download button once the archive is ready, and the API's reason when it failed. Presentational:
 * `useFolderArchives` owns the state. It reads no breakpoint.
 */
import { Alert, Box, Button, IconButton, LinearProgress, Typography } from '@mui/material';
import { Close as DismissIcon } from '@mui/icons-material';
import { formatSize } from '../../../lib/files/viewer/text';
import { isBuildingArchive, type ArchiveItem } from './useFolderArchives';

export interface ArchivePanelProps {
  items: ArchiveItem[];
  announcement: string;
  onDownload: (id: string) => void;
  onDismiss: (id: string) => void;
  onClearFinished: () => void;
}

export function ArchivePanel({ items, announcement, onDownload, onDismiss, onClearFinished }: ArchivePanelProps) {
  const finished = items.some((item) => !isBuildingArchive(item));
  if (items.length === 0) return null;
  return (
    <>
      {/* Transitions are spoken here (rendered only while an archive is listed, so a browser without archives has one status region). */}
      <Box role="status" aria-live="polite" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {announcement}
      </Box>
      {items.length > 0 && (
        <Box
          role="region"
          aria-label="Folder archives"
          data-testid="archive-panel"
          sx={{ flexShrink: 0, maxHeight: '40%', overflowY: 'auto', borderTop: 1, borderColor: 'divider', px: 1.5, py: 1 }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="subtitle2">Archives</Typography>
            {finished && (
              <Button size="small" onClick={onClearFinished}>
                Clear finished
              </Button>
            )}
          </Box>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1 }}>
            {items.map((item) => (
              <Box component="li" key={item.id} sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap title={item.path} sx={{ flex: 1, minWidth: 0 }}>
                    {item.name}
                  </Typography>
                  {item.status === 'ready' && (
                    <Button size="small" variant="contained" onClick={() => onDownload(item.id)} aria-label={`Download archive of ${item.name}`}>
                      Download
                    </Button>
                  )}
                  {!isBuildingArchive(item) && (
                    <IconButton size="small" aria-label={`Dismiss archive of ${item.name}`} onClick={() => onDismiss(item.id)}>
                      <DismissIcon fontSize="small" />
                    </IconButton>
                  )}
                </Box>
                {isBuildingArchive(item) && (
                  <>
                    <LinearProgress aria-label={`Building archive of ${item.name}`} sx={{ mt: 0.5 }} />
                    <Typography variant="caption" color="text.secondary">
                      Building the archive on the server…
                    </Typography>
                  </>
                )}
                {item.status === 'ready' && (
                  <Typography variant="caption" color="text.secondary">
                    {item.sizeBytes !== null ? `${formatSize(item.sizeBytes)}, ` : ''}ready for 24 hours
                  </Typography>
                )}
                {item.warning && item.status === 'ready' && (
                  <Alert severity="warning" sx={{ mt: 0.5 }}>
                    {item.warning}
                  </Alert>
                )}
                {(item.status === 'failed' || item.status === 'expired') && item.message && (
                  <Alert severity="error" sx={{ mt: 0.5 }}>
                    {item.message}
                  </Alert>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </>
  );
}
