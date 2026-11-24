import { useRef, useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  TextField,
  useTheme,
  Chip,
  CircularProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@mui/material';
import type { ServerProfileColor } from '../../types';
import {
  OpenInNew as OpenInNewIcon,
  PowerSettingsNew as DisconnectIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Edit as EditIcon,
  Circle as CircleIcon,
  ContentCopy as CopyIcon,
  Download as DownloadIcon,
  ContentPaste as PasteIcon,
  AddCircleOutlineOutlined as NewSessionIcon,
  UnfoldMore as UnfoldMoreIcon,
  UnfoldLess as UnfoldLessIcon,
  Keyboard as KeyboardIcon,
  UploadFile as UploadFileIcon,
  MoreVert as MoreIcon,
} from '@mui/icons-material';

interface TerminalToolbarProps {
  sessionName: string;
  isConnected: boolean;
  onOpenNewTab: () => void;
  onDisconnect: () => void;
  onRename: (newName: string) => void;
  showScrollButtons: boolean;
  onToggleScrollButtons: () => void;
  onCopyAll?: () => void;
  onDownload?: () => void;
  isDownloading?: boolean;
  onPaste?: () => void;
  /** Upload a picked file and type its link at the prompt. */
  onUpload?: (file: File) => void;
  onNewSession?: () => void;
  serverProfileName?: string;
  serverProfileColor?: ServerProfileColor;
  keyShortcutsOpen?: boolean;
  onToggleKeyShortcuts?: () => void;
  /**
   * A phone (issue #94): the name, Paste, the key bar toggle and a "More
   * actions" menu that holds EVERY action, so none is pushed off-screen.
   */
  compact?: boolean;
  /** Rename from the overflow menu (a dialog); the inline editor is desktop-only. */
  onRequestRename?: () => void;
}

/** One entry of the toolbar's overflow menu. */
interface OverflowAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  color?: 'error';
}

export function TerminalToolbar({
  sessionName,
  isConnected,
  onOpenNewTab,
  onDisconnect,
  onRename,
  showScrollButtons,
  onToggleScrollButtons,
  onCopyAll,
  onDownload,
  isDownloading,
  onPaste,
  onUpload,
  onNewSession,
  serverProfileName,
  serverProfileColor,
  keyShortcutsOpen,
  onToggleKeyShortcuts,
  compact = false,
  onRequestRename,
}: TerminalToolbarProps) {
  const theme = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(sessionName);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const handleStartEdit = () => {
    setEditValue(sessionName);
    setIsEditing(true);
  };

  const handleConfirmEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== sessionName) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditValue(sessionName);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConfirmEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const fileInput = onUpload ? (
    <input
      ref={fileInputRef}
      type="file"
      hidden
      data-testid="terminal-upload-input"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) onUpload(file);
      }}
    />
  ) : null;

  if (compact) {
    const overflow: OverflowAction[] = [
      ...(onCopyAll ? [{ key: 'copy', label: 'Copy', icon: <CopyIcon fontSize="small" />, onClick: onCopyAll }] : []),
      ...(onPaste ? [{ key: 'paste', label: 'Paste', icon: <PasteIcon fontSize="small" />, onClick: onPaste }] : []),
      ...(onDownload
        ? [
            {
              key: 'download',
              label: 'Download history',
              icon: <DownloadIcon fontSize="small" />,
              onClick: onDownload,
              disabled: isDownloading,
            },
          ]
        : []),
      ...(onUpload
        ? [
            {
              key: 'upload',
              label: 'Upload file',
              icon: <UploadFileIcon fontSize="small" />,
              onClick: () => fileInputRef.current?.click(),
            },
          ]
        : []),
      {
        key: 'scroll',
        label: showScrollButtons ? 'Hide scroll buttons' : 'Show scroll buttons',
        icon: showScrollButtons ? <UnfoldLessIcon fontSize="small" /> : <UnfoldMoreIcon fontSize="small" />,
        onClick: onToggleScrollButtons,
      },
      ...(onToggleKeyShortcuts
        ? [
            {
              key: 'keys',
              label: keyShortcutsOpen ? 'Hide key shortcuts' : 'Show key shortcuts',
              icon: <KeyboardIcon fontSize="small" />,
              onClick: onToggleKeyShortcuts,
            },
          ]
        : []),
      ...(onRequestRename
        ? [{ key: 'rename', label: 'Rename session', icon: <EditIcon fontSize="small" />, onClick: onRequestRename }]
        : []),
      ...(onNewSession
        ? [{ key: 'new', label: 'New session', icon: <NewSessionIcon fontSize="small" />, onClick: onNewSession }]
        : []),
      { key: 'open', label: 'Open in new tab', icon: <OpenInNewIcon fontSize="small" />, onClick: onOpenNewTab },
      {
        key: 'disconnect',
        label: 'Disconnect',
        icon: <DisconnectIcon fontSize="small" color="error" />,
        onClick: onDisconnect,
        color: 'error',
      },
    ];

    return (
      <Box
        role="toolbar"
        aria-label="Terminal tools"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          pl: 1,
          pr: 0.5,
          minHeight: 44,
          minWidth: 0,
          bgcolor: theme.palette.background.paper,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <CircleIcon
          aria-label={isConnected ? 'Connected' : 'Disconnected'}
          sx={{ fontSize: 10, flexShrink: 0, color: isConnected ? theme.palette.success.main : theme.palette.error.main }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" noWrap>
            {sessionName}
          </Typography>
          {serverProfileName && (
            <Typography variant="caption" noWrap component="div" sx={{ color: 'text.secondary', lineHeight: 1.2 }}>
              {serverProfileName} · {isConnected ? 'attached' : 'not connected'}
            </Typography>
          )}
        </Box>
        {onPaste && (
          <IconButton onClick={onPaste} aria-label="Paste">
            <PasteIcon fontSize="small" />
          </IconButton>
        )}
        {onToggleKeyShortcuts && (
          <IconButton
            onClick={onToggleKeyShortcuts}
            color={keyShortcutsOpen ? 'primary' : 'default'}
            aria-label="Toggle key shortcuts"
            aria-pressed={Boolean(keyShortcutsOpen)}
          >
            <KeyboardIcon fontSize="small" />
          </IconButton>
        )}
        <IconButton
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={Boolean(menuAnchor)}
          onClick={(e) => setMenuAnchor(e.currentTarget)}
        >
          {isDownloading ? <CircularProgress size={18} /> : <MoreIcon />}
        </IconButton>
        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={() => setMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          {overflow.map((action) => (
            <MenuItem
              key={action.key}
              disabled={action.disabled}
              onClick={() => {
                setMenuAnchor(null);
                action.onClick();
              }}
              sx={{ minHeight: 44, color: action.color === 'error' ? 'error.main' : undefined }}
            >
              <ListItemIcon>{action.icon}</ListItemIcon>
              <ListItemText>{action.label}</ListItemText>
            </MenuItem>
          ))}
        </Menu>
        {fileInput}
      </Box>
    );
  }

  return (
    <Box
      role="toolbar"
      aria-label="Terminal tools"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2,
        py: 0.5,
        bgcolor: theme.palette.background.paper,
        borderBottom: `1px solid ${theme.palette.divider}`,
        minHeight: 48,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      {/* Left: Session name + connection status */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Tooltip title={isConnected ? 'Connected' : 'Disconnected'}>
          <CircleIcon
            sx={{
              fontSize: 12,
              color: isConnected ? theme.palette.success.main : theme.palette.error.main,
            }}
          />
        </Tooltip>

        {serverProfileName && (
          <Chip
            label={serverProfileName}
            size="small"
            color={serverProfileColor === 'default' || !serverProfileColor ? 'primary' : serverProfileColor}
            variant="filled"
            sx={{ mr: 0.5 }}
          />
        )}

        {isEditing ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <TextField
              size="small"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              variant="standard"
              sx={{ minWidth: 200 }}
            />
            <IconButton size="small" onClick={handleConfirmEdit} color="primary">
              <CheckIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={handleCancelEdit}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap>
              {sessionName}
            </Typography>
            <Tooltip title="Rename session">
              <IconButton size="small" onClick={handleStartEdit}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>

      {/* Right: Actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Tooltip title={showScrollButtons ? 'Hide scroll buttons' : 'Show scroll buttons'}>
          <IconButton size="small" onClick={onToggleScrollButtons} aria-label="Toggle scroll buttons">
            {showScrollButtons ? <UnfoldLessIcon fontSize="small" /> : <UnfoldMoreIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        {onToggleKeyShortcuts && (
          <Tooltip title={keyShortcutsOpen ? 'Hide shortcuts' : 'Show shortcuts'}>
            <IconButton
              size="small"
              onClick={onToggleKeyShortcuts}
              color={keyShortcutsOpen ? 'primary' : 'default'}
              aria-label="Toggle key shortcuts"
            >
              <KeyboardIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {onPaste && (
          <Tooltip title="Paste from clipboard">
            <IconButton size="small" onClick={onPaste}>
              <PasteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {onCopyAll && (
          <Tooltip title="Copy selection (or all if none selected)">
            <IconButton size="small" onClick={onCopyAll}>
              <CopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {onDownload && (
          <Tooltip title="Download as text file">
            <span>
              <IconButton size="small" onClick={onDownload} disabled={isDownloading}>
                {isDownloading ? <CircularProgress size={16} /> : <DownloadIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        )}
        {onUpload && (
          <Tooltip title="Upload file">
            <IconButton size="small" onClick={() => fileInputRef.current?.click()} aria-label="Upload file">
              <UploadFileIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {fileInput}
        {onNewSession && (
          <Tooltip title="New session">
            <IconButton size="small" onClick={onNewSession}>
              <NewSessionIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Open in new tab">
          <IconButton size="small" onClick={onOpenNewTab}>
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Disconnect">
          <IconButton size="small" color="error" onClick={onDisconnect}>
            <DisconnectIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}
