/**
 * The full key panel (issue #167, epic #171). Every group of the user's
 * layout in a 4-column grid, one group per grid row, each key spanning 1 or 2
 * cells. Two placements, chosen by the workspace through `useTerminalLayout`:
 *
 * - `side` (wide screens): beside the terminal panes, like the Files and AI
 *   panels. The phone keyboard stays up and the terminal keeps its focus.
 * - `dock` (narrow phones): in the key dock under the accessory row, at the
 *   keyboard's last height, replacing it. The keyboard button brings it back.
 *
 * A tab strip heads the panel: "Keys" today; snippets (#172) and history (#173)
 * append to `KEY_PANEL_TABS`. Customize opens the shortcuts editor. Escape
 * inside the panel closes it.
 */
import { forwardRef, useState, type KeyboardEvent } from 'react';
import { Box, Button, IconButton, Tab, Tabs, Tooltip } from '@mui/material';
import {
  Close as CloseIcon,
  KeyboardOutlined as KeyboardIcon,
  TuneOutlined as CustomizeIcon,
} from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { GRID_COLUMNS } from '../../../lib/terminal/keys/keyModel';
import type { ResolvedGroup } from '../../../lib/terminal/keys/keyRow';
import { KEY_GAP, TouchKey, useKeyPopup, type TouchKeyHandlers } from './TouchKey';

/** The panel's tabs, in order. Later tabs (snippets, history) append here. */
export const KEY_PANEL_TABS = [{ id: 'keys', label: 'Keys' }] as const;
export type KeyPanelTabId = (typeof KEY_PANEL_TABS)[number]['id'];

/** The side panel's width: four 44 px targets, their gaps and the padding, with room. */
export const KEY_PANEL_SIDE_WIDTH = 320;
/** The editor the Customize button opens (#169 replaces the page behind it). */
export const KEY_PANEL_CUSTOMIZE_ROUTE = '/settings/shortcuts';

export interface TerminalKeyPanelProps extends TouchKeyHandlers {
  id: string;
  variant: 'side' | 'dock';
  /** The dock's height in px (the keyboard's last height). Ignored by `side`. */
  height?: number;
  groups: readonly ResolvedGroup[];
  onClose: () => void;
  /** `dock` only: close the panel and bring the phone keyboard back. */
  onShowKeyboard?: () => void;
}

export const TerminalKeyPanel = forwardRef<HTMLDivElement, TerminalKeyPanelProps>(function TerminalKeyPanel(
  { id, variant, height, groups, onClose, onShowKeyboard, ...handlers },
  ref,
) {
  const [tab, setTab] = useState<KeyPanelTabId>('keys');
  const popup = useKeyPopup(handlers.onSendChord);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A pop-up handles its own Escape (and stops it); this one is the panel's.
    if (event.key !== 'Escape' || popup.open) return;
    event.preventDefault();
    onClose();
  };

  return (
    <Box
      ref={ref}
      id={id}
      role="region"
      aria-label="Key panel"
      data-testid={variant === 'side' ? 'terminal-key-panel-side' : 'terminal-key-panel-dock'}
      onKeyDown={onKeyDown}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        flexShrink: 0,
        bgcolor: 'background.paper',
        ...(variant === 'side'
          ? { width: KEY_PANEL_SIDE_WIDTH, borderLeft: 1, borderColor: 'divider' }
          : { height, borderBottom: 1, borderColor: 'divider' }),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={tab}
          onChange={(_e, next: KeyPanelTabId) => setTab(next)}
          aria-label="Key panel tabs"
          variant="scrollable"
          scrollButtons={false}
          sx={{ flex: 1, minWidth: 0, minHeight: 44 }}
        >
          {KEY_PANEL_TABS.map((t) => (
            <Tab
              key={t.id}
              value={t.id}
              label={t.label}
              id={`${id}-tab-${t.id}`}
              aria-controls={`${id}-tabpanel-${t.id}`}
              sx={{ minHeight: 44 }}
            />
          ))}
        </Tabs>
        <Button
          component={RouterLink}
          to={KEY_PANEL_CUSTOMIZE_ROUTE}
          size="small"
          startIcon={<CustomizeIcon fontSize="small" />}
          sx={{ minHeight: 44 }}
        >
          Customize
        </Button>
        {variant === 'dock' && onShowKeyboard && (
          <Tooltip title="Show keyboard">
            <IconButton aria-label="Show keyboard" onClick={onShowKeyboard} sx={{ width: 44, height: 44 }}>
              <KeyboardIcon />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Close key panel">
          <IconButton
            aria-label="Close key panel"
            onMouseDown={(e) => {
              // On a wide screen, closing must not take the terminal's focus.
              if (variant === 'side') e.preventDefault();
            }}
            onClick={onClose}
            sx={{ width: 44, height: 44 }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box
        role="tabpanel"
        id={`${id}-tabpanel-keys`}
        aria-labelledby={`${id}-tab-keys`}
        hidden={tab !== 'keys'}
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1 }}
      >
        <Box
          data-testid="terminal-key-grid"
          sx={{
            display: 'grid',
            gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
            gap: KEY_GAP,
            alignItems: 'stretch',
          }}
        >
          {groups.map((group) =>
            group.keys.map((item, i) => (
              <Box
                key={item.uid}
                data-group={group.index}
                // Each group starts a new grid row.
                sx={{ gridColumn: `${i === 0 ? '1 / ' : ''}span ${item.span}`, display: 'flex', minWidth: 0 }}
              >
                <TouchKey item={item} layout="grid" onLongPress={popup.opener(item)} {...handlers} />
              </Box>
            )),
          )}
        </Box>
      </Box>
      {popup.menu}
    </Box>
  );
});
