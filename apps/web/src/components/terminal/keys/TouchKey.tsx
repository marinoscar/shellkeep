/**
 * One touch key (issue #167, epic #171), drawn by kind, for both the accessory
 * row (`TerminalKeyShortcutsBar`) and the full key panel (`TerminalKeyPanel`):
 *
 * - a modifier is the #166 toggle (off outlined, armed tonal, locked filled
 *   with a lock dot; `aria-pressed` and an `armed`/`locked` description);
 * - a key, macro or custom key is a plain key showing its label;
 * - an action is an icon with its label.
 *
 * A long press (or the context menu) opens the key's pop-up when it has one.
 * Since #168 a repeatable key repeats while held (`useKeyRepeat`; an arrow's
 * pop-up then opens with an upward swipe or the context menu), and the
 * `arrow-drag` action is a drag surface (`useArrowDrag`).
 * Every key keeps the press from taking focus (`preventDefault` on mouse down),
 * so the terminal keeps the phone keyboard. Targets are at least 44 px.
 */
import { useCallback, useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import { Box, Chip, Menu, MenuItem, Tooltip } from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import {
  ArrowDownward as ArrowDownIcon,
  ArrowBack as ArrowLeftIcon,
  ArrowForward as ArrowRightIcon,
  ArrowUpward as ArrowUpIcon,
  AttachFile as AttachIcon,
  AutoAwesomeOutlined as AiIcon,
  OpenWith as DragIcon,
  ShortText as SnippetsIcon,
} from '@mui/icons-material';
import type { Chord, KeyModifier } from '../../../lib/terminal/keys/keyModel';
import type { ModifierSnapshot, ModifierStatus } from '../../../lib/terminal/keys/modifierState';
import type { PopupEntry } from '../../../lib/terminal/keys/popupKeys';
import { popupOf, type KeyActionId, type ResolvedKey } from '../../../lib/terminal/keys/keyRow';
import { hapticTick } from '../../../lib/terminal/keys/haptics';
import type { ArrowDirection, KeyHold } from '../../../lib/terminal/keys/arrowRepeat';
import { useLongPress } from '../useLongPress';
import { useKeyRepeat } from './useKeyRepeat';
import { useArrowDrag } from './useArrowDrag';

/** The smallest touch target, in px (both sides). */
export const KEY_TARGET = 44;
/** The gap between keys, in theme spacing units. */
export const KEY_GAP = 1;

const ACTION_ICONS: Record<KeyActionId, ReactElement> = {
  ai: <AiIcon fontSize="small" />,
  'arrow-drag': <DragIcon fontSize="small" />,
  'attach-file': <AttachIcon fontSize="small" />,
  snippets: <SnippetsIcon fontSize="small" />,
};

/** The accessible names of the action keys (the AI key's is the bar's since #57). */
export const ACTION_NAMES: Record<KeyActionId, string> = {
  ai: 'Open AI assistant',
  'arrow-drag': 'Arrow drag',
  'attach-file': 'Attach a file',
  snippets: 'Snippets',
};

/** What a key does when used; the row and the panel pass the same handlers. */
export interface TouchKeyHandlers {
  /** A key, macro or custom key: send it. */
  onKey: (key: ResolvedKey) => void;
  /** An action key. */
  onAction: (action: KeyActionId) => void;
  /** A tap on a modifier toggle. Without it, modifier keys are not drawn. */
  onToggleModifier?: (modifier: KeyModifier) => void;
  /** Sends a pop-up entry. Without it, there are no pop-ups. */
  onSendChord?: (chord: Chord) => void;
  /** Each modifier's status. */
  modifierState: ModifierSnapshot;
  /** A haptic tick on each modifier toggle (and each drag gear change) where supported. */
  haptics: boolean;
  /**
   * Starts a held gesture over the terminal (#168): hold-to-repeat and the
   * arrow-drag key send through it. Without it, keys do not repeat and the
   * arrow-drag key is not drawn.
   */
  beginHold?: () => KeyHold | null;
}

interface PopupState {
  anchor: HTMLElement;
  title: string;
  entries: readonly PopupEntry[];
}

/** The pop-up of a key container: open it from a key, and the menu to render once. */
export function useKeyPopup(onSendChord?: (chord: Chord) => void) {
  const [popup, setPopup] = useState<PopupState | null>(null);
  const close = useCallback(() => setPopup(null), []);
  const opener = useCallback(
    (key: ResolvedKey) => {
      const found = onSendChord ? popupOf(key) : null;
      return found ? (anchor: HTMLElement) => setPopup({ anchor, ...found }) : undefined;
    },
    [onSendChord],
  );
  const menu = (
    <Menu
      open={popup !== null}
      anchorEl={popup?.anchor ?? null}
      onClose={close}
      anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{ list: { 'aria-label': popup?.title, dense: true } }}
    >
      {popup?.entries.map((entry) => (
        <MenuItem
          key={entry.label}
          onClick={() => {
            close();
            onSendChord?.(entry.chord);
          }}
        >
          {entry.label}
        </MenuItem>
      ))}
    </Menu>
  );
  return { open: popup !== null, opener, menu };
}

const srOnly = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

function PressableChip({
  label,
  icon,
  onTap,
  onLongPress,
  chipProps,
}: {
  label: ReactNode;
  icon?: ReactElement;
  onTap: () => void;
  onLongPress?: (anchor: HTMLElement) => void;
  chipProps: Record<string, unknown>;
}) {
  const { handlers, consumeLongPress } = useLongPress(onLongPress);
  return (
    <Chip
      label={label}
      icon={icon}
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

export interface TouchKeyProps extends TouchKeyHandlers {
  item: ResolvedKey;
  /** `row`: sized by its span in the scroller; `grid`: fills its grid cells. */
  layout: 'row' | 'grid';
  /** Opens the key's pop-up (from `useKeyPopup`). */
  onLongPress?: (anchor: HTMLElement) => void;
}

/** The sizing of a key: its span in the row, its cells in the grid. */
function sizeSx(item: ResolvedKey, layout: 'row' | 'grid') {
  const base = { minHeight: KEY_TARGET, fontSize: '0.875rem', px: 0.5 };
  if (layout === 'grid') return { ...base, width: '100%', gridColumn: `span ${item.span}` };
  // A span-2 key is two targets plus the gap between them, so it lines up with the grid.
  const minWidth = item.span === 2 ? KEY_TARGET * 2 + 8 : KEY_TARGET;
  return { ...base, minWidth, flexShrink: 0 };
}

function ModifierKey({
  item,
  modifier,
  status,
  onToggle,
  onLongPress,
  layout,
}: {
  item: ResolvedKey;
  modifier: KeyModifier;
  status: ModifierStatus;
  onToggle: () => void;
  onLongPress?: (anchor: HTMLElement) => void;
  layout: 'row' | 'grid';
}) {
  const descriptionId = useId();
  const active = status !== 'off';
  return (
    <>
      <PressableChip
        label={
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            {item.label}
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
          'data-span': item.span,
          sx: {
            ...sizeSx(item, layout),
            // Armed is filled-tonal; locked is the solid fill plus the lock dot.
            ...(status === 'armed' && {
              bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, 0.24),
              color: 'primary.main',
              '&:hover': { bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, 0.32) },
            }),
          },
        }}
      />
      {active && (
        <Box component="span" id={descriptionId} sx={srOnly}>
          {status}
        </Box>
      )}
    </>
  );
}

/** The hint a tap on the arrow-drag key shows. */
export const ARROW_DRAG_HINT = 'Press and drag to send arrow keys';
const ARROW_DRAG_HINT_MS = 2000;

const DIRECTION_ICONS: Record<ArrowDirection, ReactElement> = {
  up: <ArrowUpIcon fontSize="small" />,
  down: <ArrowDownIcon fontSize="small" />,
  left: <ArrowLeftIcon fontSize="small" />,
  right: <ArrowRightIcon fontSize="small" />,
};

/** A repeatable key (#168): tap sends once, hold repeats, an upward swipe opens the pop-up. */
function RepeatKey({
  item,
  layout,
  onKey,
  beginHold,
  onPopup,
}: {
  item: ResolvedKey;
  layout: 'row' | 'grid';
  onKey: (key: ResolvedKey) => void;
  beginHold: () => KeyHold | null;
  onPopup?: (anchor: HTMLElement) => void;
}) {
  const { handlers, consumeClick } = useKeyRepeat({
    beginHold,
    sendWith: (hold) => hold.send(item),
    onPopup,
  });
  return (
    <Chip
      label={item.label}
      clickable
      onClick={() => {
        if (consumeClick()) return;
        onKey(item);
      }}
      onMouseDown={(e) => e.preventDefault()}
      aria-haspopup={onPopup ? 'menu' : undefined}
      {...handlers}
      color="primary"
      variant="outlined"
      data-kind={item.kind}
      data-span={item.span}
      data-repeatable="true"
      // Sideways swipes still scroll the row; a vertical move stays with the key (the pop-up swipe).
      sx={{ ...sizeSx(item, layout), touchAction: 'pan-x' }}
    />
  );
}

/** The arrow-drag action key (#168): press and drag to send arrows at three speed gears. */
function ArrowDragKey({
  item,
  layout,
  beginHold,
  haptics,
}: {
  item: ResolvedKey;
  layout: 'row' | 'grid';
  beginHold: () => KeyHold | null;
  haptics: boolean;
}) {
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (!hint) return undefined;
    const timer = setTimeout(() => setHint(false), ARROW_DRAG_HINT_MS);
    return () => clearTimeout(timer);
  }, [hint]);
  const drag = useArrowDrag({ beginHold, haptics, onTapWithoutDrag: () => setHint(true) });
  const { direction, gear } = drag.reading;
  return (
    <Tooltip title={ARROW_DRAG_HINT} open={hint} onClose={() => setHint(false)} disableHoverListener disableFocusListener disableTouchListener>
      <Chip
        label={item.label}
        icon={direction ? DIRECTION_ICONS[direction] : ACTION_ICONS['arrow-drag']}
        clickable
        onClick={() => {
          if (drag.consumeClick()) return;
          setHint(true);
        }}
        onMouseDown={(e) => e.preventDefault()}
        {...drag.handlers}
        color="secondary"
        variant={drag.dragging ? 'filled' : 'outlined'}
        aria-label={ACTION_NAMES['arrow-drag']}
        aria-description={ARROW_DRAG_HINT}
        data-action="arrow-drag"
        data-span={item.span}
        data-dragging={drag.dragging ? 'true' : undefined}
        data-direction={direction ?? undefined}
        data-gear={drag.dragging ? gear : undefined}
        // The key owns every move of the finger: no browser pan while dragging on it.
        sx={{ ...sizeSx(item, layout), touchAction: 'none' }}
      />
    </Tooltip>
  );
}

/** One key of the row or the panel, drawn by its kind. */
export function TouchKey({
  item,
  layout,
  onLongPress,
  onKey,
  onAction,
  onToggleModifier,
  modifierState,
  haptics,
  beginHold,
}: TouchKeyProps) {
  if (item.kind === 'modifier') {
    if (!onToggleModifier || !item.catalogId) return null;
    const modifier = item.catalogId as KeyModifier;
    return (
      <ModifierKey
        item={item}
        modifier={modifier}
        status={modifierState[modifier]}
        layout={layout}
        onLongPress={onLongPress}
        onToggle={() => {
          hapticTick(haptics);
          onToggleModifier(modifier);
        }}
      />
    );
  }

  if (item.kind === 'action') {
    const action = item.catalogId as KeyActionId;
    if (action === 'arrow-drag') {
      return beginHold ? <ArrowDragKey item={item} layout={layout} beginHold={beginHold} haptics={haptics} /> : null;
    }
    return (
      <PressableChip
        label={item.label}
        icon={ACTION_ICONS[action]}
        onTap={() => onAction(action)}
        chipProps={{
          color: 'secondary',
          variant: 'outlined',
          'aria-label': ACTION_NAMES[action],
          'data-action': action,
          'data-span': item.span,
          sx: sizeSx(item, layout),
        }}
      />
    );
  }

  // A repeatable key repeats while held (#168); its pop-up moves to a swipe up.
  if (item.repeatable && beginHold) {
    return <RepeatKey item={item} layout={layout} onKey={onKey} beginHold={beginHold} onPopup={onLongPress} />;
  }

  // A key, a macro or a custom key.
  return (
    <PressableChip
      label={item.label}
      onTap={() => onKey(item)}
      onLongPress={onLongPress}
      chipProps={{
        color: 'primary',
        variant: 'outlined',
        'data-kind': item.kind,
        'data-span': item.span,
        'data-repeatable': item.repeatable ? 'true' : undefined,
        sx: sizeSx(item, layout),
      }}
    />
  );
}
