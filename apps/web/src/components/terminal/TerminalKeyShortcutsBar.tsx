import { Fragment } from 'react';
import { Box, Collapse, Divider, IconButton, Tooltip, Typography } from '@mui/material';
import { GridViewOutlined as PanelIcon } from '@mui/icons-material';
import { Link } from 'react-router-dom';
import type { Chord, KeyModifier } from '../../lib/terminal/keys/keyModel';
import { ALL_OFF, type ModifierSnapshot } from '../../lib/terminal/keys/modifierState';
import type { KeyActionId, ResolvedGroup, ResolvedKey } from '../../lib/terminal/keys/keyRow';
import type { KeyHold } from '../../lib/terminal/keys/arrowRepeat';
import { KEY_GAP, KEY_TARGET, TouchKey, useKeyPopup } from './keys/TouchKey';

export interface TerminalKeyShortcutsBarProps {
  open: boolean;
  /**
   * The user's key layout, resolved (`resolveKeyGroups`): drawn as ONE
   * continuous row, group after group. `null` while the settings load (only the
   * panel toggle is drawn).
   */
  groups: readonly ResolvedGroup[] | null;
  /** A key, macro or custom key was tapped. */
  onKey: (key: ResolvedKey) => void;
  /** An action key was tapped (`ai` opens the assistant, `attach-file` the upload). */
  onAction: (action: KeyActionId) => void;
  /** Each modifier's status (off, armed, locked). */
  modifierState?: ModifierSnapshot;
  /** A tap on a modifier toggle. Without it, the layout's modifiers are not drawn. */
  onToggleModifier?: (modifier: KeyModifier) => void;
  /**
   * Sends a pop-up entry (#166). Given: a long press on Ctrl, Alt or an arrow
   * opens its pop-up. Omitted: no pop-ups.
   */
  onSendChord?: (chord: Chord) => void;
  /** A haptic tick on each modifier toggle where supported (`shortcuts.options.haptics`). */
  haptics?: boolean;
  /**
   * Starts a held gesture over the terminal (#168). Given: repeatable keys
   * repeat while held and the arrow-drag key is drawn. Omitted: neither.
   */
  beginHold?: () => KeyHold | null;
  /** The full key panel is open (the pinned toggle is pressed). */
  panelOpen?: boolean;
  /** The pinned panel toggle. Omitted: no toggle. */
  onTogglePanel?: () => void;
  /** The panel's element id, for the toggle's `aria-controls`. */
  panelId?: string;
}

/**
 * The accessory row above the phone keyboard (issues #57, #80, #166, #167; epic
 * #171): the user's whole key layout as ONE horizontal scroller, groups in
 * order with a thin divider between them, and the full key panel's toggle
 * pinned at the right end, outside the scroller, so it never scrolls away. The
 * row's height is fixed (44 px keys), so it sits steadily on the keyboard
 * (`useKeyboardInset`, `keyDockOffset`).
 */
export function TerminalKeyShortcutsBar({
  open,
  groups,
  onKey,
  onAction,
  modifierState = ALL_OFF,
  onToggleModifier,
  onSendChord,
  haptics = false,
  beginHold,
  panelOpen = false,
  onTogglePanel,
  panelId,
}: TerminalKeyShortcutsBarProps) {
  const popup = useKeyPopup(onSendChord);
  const handlers = { onKey, onAction, onToggleModifier, onSendChord, modifierState, haptics, beginHold };
  const empty = groups !== null && groups.length === 0;

  return (
    <Collapse in={open} unmountOnExit>
      <Box
        data-testid="terminal-key-row"
        sx={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Box
          role="toolbar"
          aria-label="Terminal keys"
          data-testid="terminal-key-row-scroller"
          sx={{
            position: 'relative',
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            overflowX: 'auto',
            gap: KEY_GAP,
            px: 1,
            py: 0.5,
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          {empty ? (
            <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', py: 0.5 }}>
              No shortcuts configured. Add some in{' '}
              <Link to="/settings/shortcuts" style={{ color: 'inherit' }}>
                Settings
              </Link>
              .
            </Typography>
          ) : (
            (groups ?? []).map((group, i) => (
              <Fragment key={group.index}>
                {i > 0 && (
                  <Divider
                    orientation="vertical"
                    flexItem
                    data-testid="key-group-divider"
                    sx={{ my: 1, flexShrink: 0 }}
                  />
                )}
                {group.keys.map((item) => (
                  <TouchKey key={item.uid} item={item} layout="row" onLongPress={popup.opener(item)} {...handlers} />
                ))}
              </Fragment>
            ))
          )}
        </Box>
        {onTogglePanel && (
          <Box
            sx={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              px: 0.5,
              borderLeft: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
            }}
          >
            <Tooltip title={panelOpen ? 'Close key panel' : 'Open key panel'}>
              <IconButton
                id={panelId ? `${panelId}-toggle` : undefined}
                aria-label="Key panel"
                aria-expanded={panelOpen}
                aria-controls={panelOpen ? panelId : undefined}
                data-testid="terminal-key-panel-toggle"
                color={panelOpen ? 'primary' : 'default'}
                onMouseDown={(e) => e.preventDefault()}
                onClick={onTogglePanel}
                sx={{ width: KEY_TARGET, height: KEY_TARGET }}
              >
                <PanelIcon />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
      {popup.menu}
    </Collapse>
  );
}
