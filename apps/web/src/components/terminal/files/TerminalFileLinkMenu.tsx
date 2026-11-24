/**
 * The menu a file link opens (issue #155), at the pointer: Open (the viewer,
 * at the printed line), Download (a token, then the browser's own download),
 * Show in file browser (only when #156's callback is given) and Copy path.
 * A directory offers only Show in file browser and Copy path. A binary file
 * still opens: the viewer shows its binary card.
 */
import { useState } from 'react';
import { ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem, Snackbar, Alert } from '@mui/material';
import {
  ContentCopyOutlined as CopyIcon,
  DownloadOutlined as DownloadIcon,
  FolderOpenOutlined as FolderIcon,
  VisibilityOutlined as OpenIcon,
} from '@mui/icons-material';
import { useOpenFile } from '../../files/viewer/FileViewerProvider';
import { downloadRemoteFile } from '../../../services/files-api';
import { effectiveFileType } from '../../../lib/terminal/file-stat-cache';
import type { FileLinkMenuState, TerminalFileLinksConfig } from './useTerminalFileLinks';

export interface TerminalFileLinkMenuProps extends TerminalFileLinksConfig {
  sessionId: string;
  /** The open menu, or `null` when closed. */
  state: FileLinkMenuState | null;
  onClose: () => void;
}

interface Notice {
  message: string;
  severity: 'success' | 'error';
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong';
}

export function TerminalFileLinkMenu({ sessionId, profileId, onShowInFileBrowser, state, onClose }: TerminalFileLinkMenuProps) {
  const { openFile } = useOpenFile();
  const [notice, setNotice] = useState<Notice | null>(null);
  const link = state?.link ?? null;
  const type = link ? effectiveFileType(link.stat) : 'file';
  // The resolved absolute path when the API gave one, else the path as printed.
  const path = link ? link.stat.path || link.reference.path : '';

  const handleOpen = () => {
    if (!link) return;
    onClose();
    openFile({ profileId, path, sessionId, ...(link.reference.line ? { line: link.reference.line } : {}) });
  };

  const handleDownload = () => {
    if (!link) return;
    onClose();
    void downloadRemoteFile({ profileId, path, sessionId }).catch((error: unknown) =>
      setNotice({ message: `Could not download: ${errorText(error)}`, severity: 'error' }),
    );
  };

  const handleShow = () => {
    if (!link || !onShowInFileBrowser) return;
    onClose();
    onShowInFileBrowser({ profileId, path, type });
  };

  const handleCopy = () => {
    if (!link) return;
    onClose();
    const write = navigator.clipboard?.writeText(path);
    if (!write) {
      setNotice({ message: 'Could not copy the path', severity: 'error' });
      return;
    }
    void write.then(
      () => setNotice({ message: 'Path copied', severity: 'success' }),
      () => setNotice({ message: 'Could not copy the path', severity: 'error' }),
    );
  };

  const isDir = type === 'dir';
  return (
    <>
      <Menu
        open={Boolean(state)}
        onClose={onClose}
        anchorReference="anchorPosition"
        anchorPosition={state ? { top: state.anchor.y, left: state.anchor.x } : undefined}
        // Keep the terminal's focus (and a phone's keyboard state) when it closes.
        disableRestoreFocus
        slotProps={{ list: { dense: true, 'aria-label': 'File actions' } }}
      >
        <ListSubheader
          title={path}
          sx={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '32px' }}
        >
          {path}
        </ListSubheader>
        {!isDir && (
          <MenuItem onClick={handleOpen}>
            <ListItemIcon>
              <OpenIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{link?.reference.line ? `Open at line ${link.reference.line}` : 'Open'}</ListItemText>
          </MenuItem>
        )}
        {!isDir && (
          <MenuItem onClick={handleDownload}>
            <ListItemIcon>
              <DownloadIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Download</ListItemText>
          </MenuItem>
        )}
        {onShowInFileBrowser && (
          <MenuItem onClick={handleShow}>
            <ListItemIcon>
              <FolderIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Show in file browser</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={handleCopy}>
          <ListItemIcon>
            <CopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Copy path</ListItemText>
        </MenuItem>
      </Menu>
      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {notice ? (
          <Alert severity={notice.severity} onClose={() => setNotice(null)} variant="filled">
            {notice.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}
