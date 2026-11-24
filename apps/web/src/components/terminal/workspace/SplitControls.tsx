import { useState } from 'react';
import { Box, IconButton, ListSubheader, Menu, MenuItem, Tooltip } from '@mui/material';
import {
  VerticalSplitOutlined as SplitSideIcon,
  HorizontalSplitOutlined as SplitStackIcon,
} from '@mui/icons-material';
import type { SplitDirection } from './workspaceLayout';

export interface SplitCandidate {
  id: string;
  label: string;
}

export interface SplitControlsProps {
  /** The direction of the split on screen, or `null` for one pane. */
  current: SplitDirection | null;
  /** Sessions the active one can be split with (open tabs first). */
  candidates: readonly SplitCandidate[];
  onSplit: (direction: SplitDirection, otherId: string) => void;
  onSetDirection: (direction: SplitDirection) => void;
  onUnsplit: () => void;
}

const LABEL: Record<SplitDirection, string> = { v: 'Split side by side', h: 'Split top and bottom' };

/**
 * The split buttons (issue #77). Pressing a direction splits the active
 * session with another one (picked from a menu when there is a choice);
 * pressing the pressed direction again closes the split, the other changes it.
 */
export function SplitControls({ current, candidates, onSplit, onSetDirection, onUnsplit }: SplitControlsProps) {
  const [menu, setMenu] = useState<{ anchor: HTMLElement; dir: SplitDirection } | null>(null);

  const press = (dir: SplitDirection, anchor: HTMLElement) => {
    if (current === dir) return onUnsplit();
    if (current) return onSetDirection(dir);
    if (candidates.length === 1) return onSplit(dir, candidates[0].id);
    setMenu({ anchor, dir });
  };

  const disabled = !current && candidates.length === 0;
  return (
    <Box role="group" aria-label="Split" sx={{ display: 'flex' }}>
      {(['v', 'h'] as const).map((dir) => {
        const Icon = dir === 'v' ? SplitSideIcon : SplitStackIcon;
        const title = disabled ? 'Open another session to split' : current === dir ? 'Close the split' : LABEL[dir];
        return (
          <Tooltip key={dir} title={title}>
            <span>
              <IconButton
                size="small"
                aria-label={LABEL[dir]}
                aria-pressed={current === dir}
                color={current === dir ? 'primary' : 'default'}
                disabled={disabled}
                onClick={(e) => press(dir, e.currentTarget)}
              >
                <Icon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        );
      })}
      <Menu anchorEl={menu?.anchor ?? null} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <ListSubheader>Split with</ListSubheader>
        {candidates.map((c) => (
          <MenuItem
            key={c.id}
            onClick={() => {
              if (menu) onSplit(menu.dir, c.id);
              setMenu(null);
            }}
          >
            {c.label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
