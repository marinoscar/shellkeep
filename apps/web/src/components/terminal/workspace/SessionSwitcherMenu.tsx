import { useState } from 'react';
import { Box, IconButton, Popover, Tooltip } from '@mui/material';
import { SwapHoriz as SwitchIcon } from '@mui/icons-material';
import { SessionSwitcherList, useSwitcherSessions } from './SessionSwitcherList';

export interface SessionSwitcherMenuProps {
  /** The session shown now. */
  activeId: string;
  /** Open a session in the workspace. */
  onSelect: (id: string) => void;
}

function SwitcherPopoverContent({ activeId, onSelect }: SessionSwitcherMenuProps) {
  // Mounted only while open, so the list is fresh each time it opens.
  const { sessions, isLoading, error } = useSwitcherSessions(activeId);
  return (
    <Box sx={{ width: 280, maxHeight: 420, display: 'flex', flexDirection: 'column', py: 1 }}>
      <SessionSwitcherList
        sessions={sessions}
        isLoading={isLoading}
        error={error}
        selectedId={activeId}
        onSelect={onSelect}
        autoFocusFilter
      />
    </Box>
  );
}

/**
 * The session switcher as a toolbar menu (issue #77), shown wherever the
 * Sessions context pane is not drawn (the medium or collapsed rail, a phone).
 */
export function SessionSwitcherMenu({ activeId, onSelect }: SessionSwitcherMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Tooltip title="Switch session">
        <IconButton
          size="small"
          aria-label="Switch session"
          aria-haspopup="dialog"
          aria-expanded={Boolean(anchor)}
          onClick={(e) => setAnchor(e.currentTarget)}
        >
          <SwitchIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { 'aria-label': 'Switch session' } as object }}
      >
        {anchor && (
          <SwitcherPopoverContent
            activeId={activeId}
            onSelect={(id) => {
              setAnchor(null);
              onSelect(id);
            }}
          />
        )}
      </Popover>
    </>
  );
}
