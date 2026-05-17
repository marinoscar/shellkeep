import { Box, Chip, Collapse, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import type { KeyShortcut } from '../../types';

export interface TerminalKeyShortcutsBarProps {
  open: boolean;
  shortcuts: KeyShortcut[];
  onSend: (shortcut: KeyShortcut) => void;
}

export function TerminalKeyShortcutsBar({ open, shortcuts, onSend }: TerminalKeyShortcutsBarProps) {
  return (
    <Collapse in={open} unmountOnExit>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          overflowX: 'auto',
          gap: 1,
          px: 1,
          py: 0.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {shortcuts.length === 0 ? (
          <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', py: 0.5 }}>
            No shortcuts configured. Add some in{' '}
            <Link to="/settings" style={{ color: 'inherit' }}>
              Settings
            </Link>
            .
          </Typography>
        ) : (
          shortcuts.map((shortcut) => (
            <Chip
              key={shortcut.id}
              label={shortcut.label}
              color="primary"
              variant="outlined"
              clickable
              onClick={() => onSend(shortcut)}
              onMouseDown={(e) => e.preventDefault()}
              sx={{
                minHeight: 44,
                fontSize: '0.875rem',
                px: 0.5,
                flexShrink: 0,
              }}
            />
          ))
        )}
      </Box>
    </Collapse>
  );
}
