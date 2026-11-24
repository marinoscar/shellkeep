import { useState, type MouseEvent } from 'react';
import { Button, ListItemText, Menu, MenuItem } from '@mui/material';
import { ManageSearchOutlined as ExplainIcon } from '@mui/icons-material';

export interface ExplainMenuButtonProps {
  /** Ask the assistant to explain the focused terminal's selection or its last error. */
  onExplain: (mode: 'selection' | 'last_error') => void;
  /** Whether the focused terminal has text selected right now. Read when the menu opens. */
  hasSelection: () => boolean;
  disabled?: boolean;
}

/** The toolbar's "Explain" button: explain the selection, or the last error (issue #58). */
export function ExplainMenuButton({ onExplain, hasSelection, disabled = false }: ExplainMenuButtonProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState(false);

  const open = (event: MouseEvent<HTMLElement>) => {
    setSelected(hasSelection());
    setAnchor(event.currentTarget);
  };
  const choose = (mode: 'selection' | 'last_error') => {
    setAnchor(null);
    onExplain(mode);
  };

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<ExplainIcon fontSize="small" />}
        aria-haspopup="menu"
        aria-expanded={anchor ? true : undefined}
        disabled={disabled}
        onClick={open}
        sx={{ minHeight: 32, ml: 0.5 }}
      >
        Explain
      </Button>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        <MenuItem disabled={!selected} onClick={() => choose('selection')}>
          <ListItemText primary="Explain selection" secondary={selected ? undefined : 'Select text in the terminal first'} />
        </MenuItem>
        <MenuItem onClick={() => choose('last_error')}>
          <ListItemText primary="Explain last error" />
        </MenuItem>
      </Menu>
    </>
  );
}
