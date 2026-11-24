import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Chip, Collapse, Menu, MenuItem, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Link } from 'react-router-dom';
import type { KeyShortcut } from '../../types';
import type { Chord, KeyModifier } from '../../lib/terminal/keys/keyModel';
import { ALL_OFF, type ModifierSnapshot, type ModifierStatus } from '../../lib/terminal/keys/modifierState';
import { ALT_POPUP, ARROW_POPUP, CTRL_POPUP, type PopupEntry } from '../../lib/terminal/keys/popupKeys';
import { hapticTick } from '../../lib/terminal/keys/haptics';
import { useLongPress } from './useLongPress';

/** The modifier keys the bar can draw as toggles (#166): the layout's catalog ids. */
export type BarModifier = 'ctrl' | 'alt' | 'shift';

const MODIFIER_LABELS: Record<BarModifier, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
const MODIFIER_POPUPS: Partial<Record<BarModifier, readonly PopupEntry[]>> = { ctrl: CTRL_POPUP, alt: ALT_POPUP };
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export interface TerminalKeyShortcutsBarProps {
  open: boolean;
  shortcuts: KeyShortcut[];
  onSend: (shortcut: KeyShortcut) => void;
  /** Opens the AI assistant (#57). Omit when AI is unavailable: no AI key is drawn. */
  onAiAssist?: () => void;
  /** The modifier toggles to draw, in order (#166); none when omitted. */
  modifierKeys?: readonly BarModifier[];
  /** Each modifier's status (off, armed, locked). */
  modifierState?: ModifierSnapshot;
  /** A tap on a modifier toggle. */
  onToggleModifier?: (modifier: KeyModifier) => void;
  /**
   * Sends a pop-up entry (#166). Given: a long press on Ctrl, Alt or an arrow
   * opens its pop-up. Omitted: no pop-ups.
   */
  onSendChord?: (chord: Chord) => void;
  /** A haptic tick on each modifier toggle where supported (`shortcuts.options.haptics`). */
  haptics?: boolean;
}

interface PopupState {
  anchor: HTMLElement;
  title: string;
  entries: readonly PopupEntry[];
}

const keySx = { minHeight: 44, fontSize: '0.875rem', px: 0.5, flexShrink: 0 } as const;

function isArrowShortcut(shortcut: KeyShortcut): boolean {
  return (
    shortcut.keystrokes.length === 1 &&
    shortcut.keystrokes[0].modifiers.length === 0 &&
    ARROW_KEYS.has(shortcut.keystrokes[0].key)
  );
}

/** One key of the bar with an optional long-press pop-up. */
function BarKey({
  label,
  onTap,
  onLongPress,
  chipProps,
}: {
  label: ReactNode;
  onTap: () => void;
  onLongPress?: (anchor: HTMLElement) => void;
  chipProps: Record<string, unknown>;
}) {
  const { handlers, consumeLongPress } = useLongPress(onLongPress);
  return (
    <Chip
      label={label}
      clickable
      onClick={() => {
        if (consumeLongPress()) return;
        onTap();
      }}
      onMouseDown={(e) => e.preventDefault()}
      aria-haspopup={onLongPress ? 'menu' : undefined}
      {...handlers}
      {...chipProps}
    />
  );
}

function ModifierKey({
  modifier,
  status,
  onToggle,
  onLongPress,
}: {
  modifier: BarModifier;
  status: ModifierStatus;
  onToggle: () => void;
  onLongPress?: (anchor: HTMLElement) => void;
}) {
  const descriptionId = useId();
  const active = status !== 'off';
  return (
    <>
      <BarKey
        label={
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            {MODIFIER_LABELS[modifier]}
            {status === 'locked' && (
              <Box
                component="span"
                aria-hidden
                data-testid={`modifier-lock-${modifier}`}
                sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'currentColor' }}
              />
            )}
          </Box>
        }
        onTap={onToggle}
        onLongPress={onLongPress}
        chipProps={{
          color: 'primary',
          variant: active ? 'filled' : 'outlined',
          'aria-pressed': active,
          'aria-describedby': active ? descriptionId : undefined,
          'data-modifier': modifier,
          'data-state': status,
          sx: {
            ...keySx,
            // Armed is filled-tonal; locked is the solid fill plus the lock dot.
            ...(status === 'armed' && {
              bgcolor: (theme: { palette: { primary: { main: string } } }) => alpha(theme.palette.primary.main, 0.24),
              color: 'primary.main',
              '&:hover': {
                bgcolor: (theme: { palette: { primary: { main: string } } }) =>
                  alpha(theme.palette.primary.main, 0.32),
              },
            }),
          },
        }}
      />
      {active && (
        <Box
          component="span"
          id={descriptionId}
          sx={{
            position: 'absolute',
            width: 1,
            height: 1,
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
            whiteSpace: 'nowrap',
          }}
        >
          {status}
        </Box>
      )}
    </>
  );
}

export function TerminalKeyShortcutsBar({
  open,
  shortcuts,
  onSend,
  onAiAssist,
  modifierKeys = [],
  modifierState = ALL_OFF,
  onToggleModifier,
  onSendChord,
  haptics = false,
}: TerminalKeyShortcutsBarProps) {
  const [popup, setPopup] = useState<PopupState | null>(null);
  const closePopup = useCallback(() => setPopup(null), []);
  const openPopup = (title: string, entries: readonly PopupEntry[]) =>
    onSendChord ? (anchor: HTMLElement) => setPopup({ anchor, title, entries }) : undefined;

  const toggles = onToggleModifier ? modifierKeys : [];

  return (
    <Collapse in={open} unmountOnExit>
      <Box
        sx={{
          position: 'relative',
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
        {onAiAssist && (
          <Chip
            label="AI"
            color="secondary"
            clickable
            onClick={onAiAssist}
            onMouseDown={(e) => e.preventDefault()}
            aria-label="Open AI assistant"
            sx={keySx}
          />
        )}
        {toggles.map((modifier) => {
          const entries = MODIFIER_POPUPS[modifier];
          return (
            <ModifierKey
              key={modifier}
              modifier={modifier}
              status={modifierState[modifier]}
              onToggle={() => {
                hapticTick(haptics);
                onToggleModifier?.(modifier);
              }}
              onLongPress={entries ? openPopup(`${MODIFIER_LABELS[modifier]} combinations`, entries) : undefined}
            />
          );
        })}
        {shortcuts.length === 0 ? (
          <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', py: 0.5 }}>
            No shortcuts configured. Add some in{' '}
            <Link to="/settings/shortcuts" style={{ color: 'inherit' }}>
              Settings
            </Link>
            .
          </Typography>
        ) : (
          shortcuts.map((shortcut) => (
            <BarKey
              key={shortcut.id}
              label={shortcut.label}
              onTap={() => onSend(shortcut)}
              onLongPress={isArrowShortcut(shortcut) ? openPopup('Navigation keys', ARROW_POPUP) : undefined}
              chipProps={{ color: 'primary', variant: 'outlined', sx: keySx }}
            />
          ))
        )}
      </Box>
      <Menu
        open={popup !== null}
        anchorEl={popup?.anchor ?? null}
        onClose={closePopup}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ list: { 'aria-label': popup?.title, dense: true } }}
      >
        {popup?.entries.map((entry) => (
          <MenuItem
            key={entry.label}
            onClick={() => {
              closePopup();
              onSendChord?.(entry.chord);
            }}
          >
            {entry.label}
          </MenuItem>
        ))}
      </Menu>
    </Collapse>
  );
}
