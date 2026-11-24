/**
 * The terminal workspace's Files panel (issue #156): the `FileBrowser` for the
 * active session's server, docked like the AI panel (`TerminalAiPanel`). On
 * `md` and up (`useTerminalLayout().isWide`, decided by the page) it docks
 * right of the panes, resizable between 300 and 560 px; below, it is a bottom
 * sheet. The page shows it only to a holder of `sessions:write`, the files
 * API's access rule, and opens at most one of the two side panels at a time.
 */
import { useRef, useState, type PointerEvent } from 'react';
import { Box, Drawer, IconButton, Tooltip, Typography } from '@mui/material';
import { Close as CloseIcon, FolderOpenOutlined as FilesIcon } from '@mui/icons-material';
import { FileBrowser, type FileBrowserReveal } from '../../files/browser/FileBrowser';

export const FILES_PANEL_MIN_WIDTH = 300;
export const FILES_PANEL_MAX_WIDTH = 560;
const FILES_PANEL_DEFAULT_WIDTH = 360;

export interface FileBrowserPanelProps {
  open: boolean;
  onClose: () => void;
  /** `side`: docked right of the panes (`md` and up); `sheet`: a bottom drawer (phone, tablet). */
  variant: 'side' | 'sheet';
  profileId: string;
  /** The active session: Follow lists its working directory. */
  sessionId: string;
  /** "Show in file browser": the folder to open and the entry to select. */
  reveal?: FileBrowserReveal | null;
}

function PanelBody({ onClose, profileId, sessionId, reveal }: Omit<FileBrowserPanelProps, 'open' | 'variant'>) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <FilesIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Files
        </Typography>
        <Tooltip title="Close files">
          <IconButton size="small" aria-label="Close files" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {/* A new server is a new browser; a new session on the same server keeps the folder. */}
        <FileBrowser key={profileId} profileId={profileId} sessionId={sessionId} reveal={reveal} aria-label="Server files" />
      </Box>
    </Box>
  );
}

export function FileBrowserPanel({ open, onClose, variant, profileId, sessionId, reveal = null }: FileBrowserPanelProps) {
  const [width, setWidth] = useState(FILES_PANEL_DEFAULT_WIDTH);
  const panelRef = useRef<HTMLDivElement>(null);

  if (variant === 'sheet') {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        slotProps={{
          paper: {
            'aria-label': 'Files',
            'data-testid': 'terminal-files-sheet',
            sx: { height: '75dvh', borderTopLeftRadius: 12, borderTopRightRadius: 12 },
          } as object,
        }}
      >
        <PanelBody onClose={onClose} profileId={profileId} sessionId={sessionId} reveal={reveal} />
      </Drawer>
    );
  }

  if (!open) return null;

  const clamp = (w: number) => Math.min(FILES_PANEL_MAX_WIDTH, Math.max(FILES_PANEL_MIN_WIDTH, w));
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    const right = panelRef.current?.getBoundingClientRect().right ?? 0;
    setWidth(clamp(Math.round(right - e.clientX)));
  };

  return (
    <Box
      ref={panelRef}
      component="aside"
      aria-label="Files"
      data-testid="terminal-files-panel"
      style={{ width }}
      sx={{
        position: 'relative',
        flexShrink: 0,
        minHeight: 0,
        bgcolor: 'background.paper',
        borderLeft: 1,
        borderColor: 'divider',
      }}
    >
      <Box
        role="separator"
        aria-label="Resize files"
        aria-orientation="vertical"
        aria-valuemin={FILES_PANEL_MIN_WIDTH}
        aria-valuemax={FILES_PANEL_MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowLeft' ? 16 : e.key === 'ArrowRight' ? -16 : 0;
          if (!step) return;
          e.preventDefault();
          setWidth((w) => clamp(w + step));
        }}
        sx={{
          position: 'absolute',
          left: -3,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: 'col-resize',
          zIndex: 1,
          touchAction: 'none',
          '&:hover, &:focus-visible': { bgcolor: 'primary.main', opacity: 0.6, outline: 'none' },
        }}
      />
      <PanelBody onClose={onClose} profileId={profileId} sessionId={sessionId} reveal={reveal} />
    </Box>
  );
}
