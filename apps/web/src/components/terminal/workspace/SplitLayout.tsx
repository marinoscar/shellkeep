import { useCallback, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Box } from '@mui/material';
import type { SplitDirection } from './workspaceLayout';

/** The split's first pane takes between these shares of the area (percent). */
export const MIN_RATIO = 20;
export const MAX_RATIO = 80;
/** The divider's thickness in px. */
const DIVIDER = 6;

export function clampRatio(value: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, Math.round(value)));
}

export interface SplitLayoutProps {
  /** Every open session, in a stable order: each keeps one mounted pane. */
  paneIds: readonly string[];
  /** The one or two sessions on screen, in pane order. */
  visible: readonly string[];
  /** The split's direction (used when two panes are visible). */
  direction: SplitDirection;
  /** The first pane's share of the area, percent. */
  ratio: number;
  onRatioChange: (ratio: number) => void;
  /** The focused session (drawn with an accent border while split). */
  focusedId: string;
  onFocusPane: (id: string) => void;
  /** A pane's header while split (its number, name, close button), or nothing. */
  renderHeader?: (id: string, index: number) => ReactNode;
  /** The pane's content: a `TerminalView` and its overlays. */
  renderPane: (id: string) => ReactNode;
}

type Rect = { top: string; left: string; width: string; height: string };

function paneRect(index: number, count: number, direction: SplitDirection, ratio: number): Rect {
  if (count < 2) return { top: '0px', left: '0px', width: '100%', height: '100%' };
  const half = DIVIDER / 2;
  const first = index === 0;
  const start = first ? '0px' : `calc(${ratio}% + ${half}px)`;
  const size = first ? `calc(${ratio}% - ${half}px)` : `calc(${100 - ratio}% - ${half}px)`;
  return direction === 'v'
    ? { top: '0px', left: start, width: size, height: '100%' }
    : { top: start, left: '0px', width: '100%', height: size };
}

/**
 * The workspace's panes (issue #77): none, a vertical or a horizontal split,
 * two panes at most, with a draggable divider.
 *
 * EVERY open session keeps its pane mounted (its xterm and its WebSocket), so
 * switching tabs never reconnects. A pane that is not on screen is moved out of
 * view with `visibility: hidden` and a far negative `left`, never
 * `display: none`: its `offsetParent` stays non-null and xterm keeps handling
 * scroll (docs/specs/terminal.md, "Common Pitfalls"). It keeps the full area's size,
 * so it does not refit to nothing; when it comes back, the debounced
 * `ResizeObserver` of `useTerminal` fits it to its slot and sends `resize`.
 *
 * The area is a positioned box with `minHeight: 0` and no `overflow: hidden`;
 * each pane is a flex column whose host box (the FitAddon host's parent) has
 * `flex: 1` and `minHeight: 0`.
 */
export function SplitLayout({
  paneIds,
  visible,
  direction,
  ratio,
  onRatioChange,
  focusedId,
  onFocusPane,
  renderHeader,
  renderPane,
}: SplitLayoutProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const split = visible.length > 1;

  const ratioAt = useCallback(
    (clientX: number, clientY: number) => {
      const rect = areaRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return ratio;
      return direction === 'v'
        ? ((clientX - rect.left) / rect.width) * 100
        : ((clientY - rect.top) / rect.height) * 100;
    },
    [direction, ratio],
  );

  const onDividerPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onDividerPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    onRatioChange(clampRatio(ratioAt(e.clientX, e.clientY)));
  };
  const onDividerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const back = direction === 'v' ? 'ArrowLeft' : 'ArrowUp';
    const forward = direction === 'v' ? 'ArrowRight' : 'ArrowDown';
    if (e.key === back) onRatioChange(clampRatio(ratio - 5));
    else if (e.key === forward) onRatioChange(clampRatio(ratio + 5));
    else return;
    e.preventDefault();
  };

  return (
    <Box
      ref={areaRef}
      data-testid="terminal-panes"
      data-split={split ? direction : 'none'}
      aria-label="Terminal panes"
      sx={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative' }}
    >
      {paneIds.map((id) => {
        const index = visible.indexOf(id);
        const shown = index !== -1;
        const rect = shown
          ? paneRect(index, visible.length, direction, ratio)
          : { top: '0px', left: '-100000px', width: '100%', height: '100%' };
        const focused = split && id === focusedId;
        return (
          <Box
            key={id}
            data-testid={`terminal-pane-${id}`}
            data-pane-visible={shown ? 'true' : 'false'}
            aria-hidden={shown ? undefined : true}
            aria-label={shown ? `Terminal pane ${index + 1}` : undefined}
            role={shown ? 'region' : undefined}
            onPointerDownCapture={shown ? () => onFocusPane(id) : undefined}
            style={{ ...rect, visibility: shown ? 'visible' : 'hidden' }}
            sx={{
              position: 'absolute',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              minWidth: 0,
              boxSizing: 'border-box',
              border: split && shown ? 2 : 0,
              borderColor: focused ? 'primary.main' : 'divider',
              borderRadius: split && shown ? 1 : 0,
            }}
          >
            {split && shown && renderHeader?.(id, index)}
            <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative' }}>{renderPane(id)}</Box>
          </Box>
        );
      })}
      {split && (
        <Box
          role="separator"
          tabIndex={0}
          aria-label="Resize panes"
          aria-orientation={direction === 'v' ? 'vertical' : 'horizontal'}
          aria-valuemin={MIN_RATIO}
          aria-valuemax={MAX_RATIO}
          aria-valuenow={ratio}
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onKeyDown={onDividerKeyDown}
          style={
            direction === 'v'
              ? { top: 0, bottom: 0, left: `calc(${ratio}% - ${DIVIDER / 2}px)`, width: DIVIDER }
              : { left: 0, right: 0, top: `calc(${ratio}% - ${DIVIDER / 2}px)`, height: DIVIDER }
          }
          sx={{
            position: 'absolute',
            zIndex: 6,
            cursor: direction === 'v' ? 'col-resize' : 'row-resize',
            touchAction: 'none',
            '&:hover, &:focus-visible': { bgcolor: 'primary.main', opacity: 0.6, outline: 'none' },
          }}
        />
      )}
    </Box>
  );
}
