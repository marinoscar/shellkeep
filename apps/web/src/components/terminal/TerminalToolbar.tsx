import { useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  TextField,
  useTheme,
  Chip,
  CircularProgress,
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
  AddCircleOutline as NewSessionIcon,
  UnfoldMore as UnfoldMoreIcon,
  UnfoldLess as UnfoldLessIcon,
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
  onNewSession?: () => void;
  serverProfileName?: string;
  serverProfileColor?: ServerProfileColor;
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
  onNewSession,
  serverProfileName,
  serverProfileColor,
}: TerminalToolbarProps) {
  const theme = useTheme();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(sessionName);

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

  return (
    <Box
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
