import { useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { Box, ButtonBase, Chip, IconButton, Tooltip, Typography } from '@mui/material';
import { Add as AddIcon, Close as CloseIcon } from '@mui/icons-material';
import type { TerminalSession } from '../../../types';

/** What the tabs know about one open session. */
export interface WorkspaceTabInfo {
  id: string;
  /** `null` while the session is loading. */
  session: TerminalSession | null;
  /** The pane's socket is attached. */
  connected: boolean;
}

export interface WorkspaceTabsProps {
  tabs: readonly WorkspaceTabInfo[];
  activeId: string;
  /** `tabs`: the desktop/tablet strip; `chips`: the phone's swipeable chip row. */
  variant: 'tabs' | 'chips';
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** Ask to rename (double-click a tab). */
  onRename?: (id: string) => void;
  /** Drag to reorder: the tab at `from` moves to `to`. */
  onReorder?: (from: number, to: number) => void;
  /** "New session"; absent hides the button (no `sessions:write`). */
  onNewSession?: () => void;
  /** Controls at the strip's right end (split, AI, the switcher). */
  trailing?: ReactNode;
}

function tabLabel(tab: WorkspaceTabInfo): string {
  return tab.session?.name ?? 'Loading…';
}

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        flexShrink: 0,
        bgcolor: connected ? 'success.main' : 'text.disabled',
      }}
    />
  );
}

/**
 * The open sessions (issue #77). On a desktop or tablet, a tab strip: click
 * to switch, the × or a middle click to close, double-click to rename, drag to
 * reorder. On a phone, a horizontally swipeable chip row with the same open,
 * switch and close.
 */
export function WorkspaceTabs({
  tabs,
  activeId,
  variant,
  onActivate,
  onClose,
  onRename,
  onReorder,
  onNewSession,
  trailing,
}: WorkspaceTabsProps) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  if (variant === 'chips') {
    return (
      <Box
        role="tablist"
        aria-label="Open sessions"
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1,
          py: 0.5,
          overflowX: 'auto',
          flexShrink: 0,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {tabs.map((tab) => {
          const selected = tab.id === activeId;
          return (
            <Chip
              key={tab.id}
              role="tab"
              aria-selected={selected}
              icon={<StatusDot connected={tab.connected} />}
              label={tabLabel(tab)}
              color={selected ? 'primary' : 'default'}
              variant={selected ? 'filled' : 'outlined'}
              onClick={() => onActivate(tab.id)}
              onDelete={() => onClose(tab.id)}
              deleteIcon={<CloseIcon aria-label={`Close ${tabLabel(tab)}`} />}
              sx={{ flexShrink: 0, minHeight: 36, pl: 0.5 }}
            />
          );
        })}
        {onNewSession && (
          <IconButton size="small" aria-label="New session" onClick={onNewSession} sx={{ flexShrink: 0 }}>
            <AddIcon fontSize="small" />
          </IconButton>
        )}
        {trailing && <Box sx={{ display: 'flex', alignItems: 'center', ml: 'auto', flexShrink: 0 }}>{trailing}</Box>}
      </Box>
    );
  }

  const onDragStart = (index: number) => (e: DragEvent) => {
    setDragFrom(index);
    e.dataTransfer.effectAllowed = 'move';
    // Firefox starts a drag only with data set.
    e.dataTransfer.setData('text/plain', tabs[index].id);
  };
  const onDrop = (index: number) => (e: DragEvent) => {
    e.preventDefault();
    if (dragFrom !== null) onReorder?.(dragFrom, index);
    setDragFrom(null);
  };
  const onAuxClick = (id: string) => (e: MouseEvent) => {
    // A middle click closes, as in a browser.
    if (e.button === 1) {
      e.preventDefault();
      onClose(id);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'stretch',
        flexShrink: 0,
        minWidth: 0,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Box role="tablist" aria-label="Open sessions" sx={{ display: 'flex', minWidth: 0, overflowX: 'auto' }}>
        {tabs.map((tab, index) => {
          const selected = tab.id === activeId;
          const label = tabLabel(tab);
          return (
            <Box
              key={tab.id}
              draggable={Boolean(onReorder)}
              onDragStart={onDragStart(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop(index)}
              onDragEnd={() => setDragFrom(null)}
              onAuxClick={onAuxClick(tab.id)}
              onMouseDown={(e) => {
                // Keep the middle click from starting an autoscroll.
                if (e.button === 1) e.preventDefault();
              }}
              sx={{
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
                borderRight: 1,
                borderColor: 'divider',
                borderTop: 2,
                borderTopColor: selected ? 'primary.main' : 'transparent',
                bgcolor: selected ? 'background.default' : 'transparent',
                opacity: dragFrom === index ? 0.5 : 1,
              }}
            >
              <ButtonBase
                role="tab"
                aria-selected={selected}
                data-testid={`workspace-tab-${tab.id}`}
                onClick={() => onActivate(tab.id)}
                onDoubleClick={onRename ? () => onRename(tab.id) : undefined}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 1.5, pr: 0.5, minHeight: 40, maxWidth: 240 }}
              >
                <StatusDot connected={tab.connected} />
                <Typography variant="body2" noWrap sx={{ fontWeight: selected ? 600 : 400 }}>
                  {label}
                </Typography>
                {tab.session && (
                  <Typography variant="caption" noWrap sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                    {tab.session.serverProfile.name}
                  </Typography>
                )}
              </ButtonBase>
              <Tooltip title="Close tab">
                <IconButton size="small" aria-label={`Close ${label}`} onClick={() => onClose(tab.id)} sx={{ mr: 0.5 }}>
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Box>
          );
        })}
      </Box>
      {onNewSession && (
        <Tooltip title="New session">
          <IconButton aria-label="New session" onClick={onNewSession} sx={{ alignSelf: 'center', mx: 0.5 }}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <Box sx={{ flex: 1 }} />
      {trailing && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, flexShrink: 0 }}>{trailing}</Box>}
    </Box>
  );
}
