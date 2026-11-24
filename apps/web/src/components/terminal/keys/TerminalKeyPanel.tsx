/**
 * The full key panel (issue #167, epic #171). Every group of the user's
 * layout in a 4-column grid, one group per grid row, each key spanning 1 or 2
 * cells. Two placements, chosen by the workspace through `useTerminalLayout`:
 *
 * - `side` (anything but a phone: tablets, landscape, unfolded foldables):
 *   beside the terminal panes. The phone keyboard stays up and the terminal
 *   keeps its focus.
 * - `dock` (phones): in the key dock under the accessory row, at the
 *   keyboard's last height, replacing it. The keyboard button brings it back.
 *
 * A tab strip heads the panel: Keys and Snippets (#172); history (#173)
 * appends to `KEY_PANEL_TABS`. The Snippets tab is drawn only when the host
 * can insert text (`onInsertSnippet`). Customize opens the shortcuts editor.
 * Escape inside the panel closes it.
 */
import { forwardRef, useEffect, useState, type KeyboardEvent } from 'react';
import { Box, Button, IconButton, Tab, Tabs, Tooltip } from '@mui/material';
import {
  Close as CloseIcon,
  KeyboardOutlined as KeyboardIcon,
  TuneOutlined as CustomizeIcon,
} from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { GRID_COLUMNS } from '../../../lib/terminal/keys/keyModel';
import type { ResolvedGroup } from '../../../lib/terminal/keys/keyRow';
import type { SnippetInsertResult } from '../../../lib/terminal/snippets/insert';
import { SnippetsTab } from './snippets/SnippetsTab';
import { KEY_GAP, TouchKey, useKeyPopup, type TouchKeyHandlers } from './TouchKey';

/** The panel's tabs, in order. Later tabs (history) append here. */
export const KEY_PANEL_TABS = [
  { id: 'keys', label: 'Keys' },
  { id: 'snippets', label: 'Snippets' },
] as const;
export type KeyPanelTabId = (typeof KEY_PANEL_TABS)[number]['id'];

/** Asks the panel to show a tab (the snippets action key). `n` makes a repeat request count. */
export interface KeyPanelTabRequest {
  tab: KeyPanelTabId;
  n: number;
}

/**
 * The side panel's width: 320 px (four 44 px targets, their gaps and padding,
 * with room), but never more than 40% of the workspace, so a ~600 px tablet or
 * foldable keeps most of its width for the terminal. CSS `min()`, not a
 * breakpoint read.
 */
export const KEY_PANEL_SIDE_WIDTH = 'min(320px, 40%)';
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
  /** Puts snippet text at the terminal's prompt (never runs it). Without it, there is no Snippets tab. */
  onInsertSnippet?: (text: string, options?: { confirmed?: boolean }) => SnippetInsertResult;
  /** The Snippets tab is taking text input (the phone keyboard rises over a docked panel). */
  onTextEntry?: (active: boolean) => void;
  /** Show this tab now (the snippets action key). */
  tabRequest?: KeyPanelTabRequest | null;
}

export const TerminalKeyPanel = forwardRef<HTMLDivElement, TerminalKeyPanelProps>(function TerminalKeyPanel(
  { id, variant, height, groups, onClose, onShowKeyboard, onInsertSnippet, onTextEntry, tabRequest, ...handlers },
  ref,
) {
  const tabs = KEY_PANEL_TABS.filter((t) => t.id !== 'snippets' || onInsertSnippet);
  const [tab, setTab] = useState<KeyPanelTabId>(tabRequest?.tab ?? 'keys');
  useEffect(() => {
    if (tabRequest) setTab(tabRequest.tab);
  }, [tabRequest]);
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
          ? { width: KEY_PANEL_SIDE_WIDTH, minWidth: 0, borderLeft: 1, borderColor: 'divider' }
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
          {tabs.map((t) => (
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
      {onInsertSnippet && tab === 'snippets' && (
        <Box
          role="tabpanel"
          id={`${id}-tabpanel-snippets`}
          aria-labelledby={`${id}-tab-snippets`}
          sx={{ flex: 1, minHeight: 0, p: 1, display: 'flex', flexDirection: 'column' }}
        >
          <SnippetsTab onInsert={onInsertSnippet} onTextEntry={onTextEntry} />
        </Box>
      )}
      {popup.menu}
    </Box>
  );
});
