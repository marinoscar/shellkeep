/**
 * The viewer as a full-screen dialog over the current page (issue #154), what
 * `openFile` shows. Full screen at every width, so no breakpoint is read.
 */
import { Dialog, IconButton, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Link as RouterLink } from 'react-router-dom';
import { FileViewer } from './FileViewer';
import { fileBaseName } from '../../../lib/files/viewer/language';
import { fileViewerPath, type OpenFileTarget } from './FileViewerProvider';

export interface FileViewerDialogProps {
  target: OpenFileTarget;
  onClose: () => void;
}

export default function FileViewerDialog({ target, onClose }: FileViewerDialogProps) {
  return (
    <Dialog
      open
      fullScreen
      onClose={onClose}
      aria-label={`File ${fileBaseName(target.path) || target.path}`}
      slotProps={{ paper: { sx: { bgcolor: 'background.paper' } } }}
    >
      <FileViewer
        key={`${target.profileId}:${target.path}:${target.sessionId ?? ''}:${target.line ?? ''}`}
        profileId={target.profileId}
        path={target.path}
        sessionId={target.sessionId}
        line={target.line}
        headerActions={
          <>
            <Tooltip title="Open as a page">
              <IconButton
                component={RouterLink}
                to={fileViewerPath(target)}
                onClick={onClose}
                aria-label="Open as a page"
                size="small"
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Close">
              <IconButton onClick={onClose} aria-label="Close file" size="small">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        }
      />
    </Dialog>
  );
}
