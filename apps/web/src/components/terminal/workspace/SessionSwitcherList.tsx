import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  TextField,
  Typography,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { getSessions } from '../../../services/terminal-api';
import type { TerminalSession } from '../../../types';

/** The sessions a switcher lists: every one that is not terminated, newest activity first. */
export function switchableSessions(items: readonly TerminalSession[]): TerminalSession[] {
  return items
    .filter((s) => s.status !== 'terminated')
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/** Sessions grouped by server, groups in name order. Exported for tests. */
export function groupByServer(items: readonly TerminalSession[]): Array<{ server: string; sessions: TerminalSession[] }> {
  const groups = new Map<string, TerminalSession[]>();
  for (const session of items) {
    const server = session.serverProfile.name;
    groups.set(server, [...(groups.get(server) ?? []), session]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([server, sessions]) => ({ server, sessions }));
}

export interface UseSwitcherSessionsResult {
  sessions: TerminalSession[];
  isLoading: boolean;
  error: string | null;
}

/**
 * The user's switchable sessions (`GET /api/sessions`, owner-scoped by the
 * API), fetched again whenever `refreshKey` changes (the pane passes the
 * pathname, so a session opened or created elsewhere shows up).
 */
export function useSwitcherSessions(refreshKey: string): UseSwitcherSessionsResult {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSessions({ pageSize: 100 })
      .then((response) => {
        if (cancelled) return;
        setSessions(switchableSessions(response?.items ?? []));
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load sessions');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { sessions, isLoading, error };
}

const STATUS_COLOR: Record<TerminalSession['status'], string> = {
  active: 'success.main',
  detached: 'warning.main',
  terminated: 'text.disabled',
};

export interface SessionSwitcherListProps {
  sessions: readonly TerminalSession[];
  isLoading: boolean;
  error: string | null;
  /** The session shown now (highlighted). */
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Put the filter field in focus on mount (the toolbar menu). */
  autoFocusFilter?: boolean;
}

/**
 * The session switcher's list (issue #77), shared by the Sessions context
 * pane beside the expanded rail and the workspace toolbar's menu below it:
 * a filter, then the active and detached sessions grouped by server, each
 * with a status dot.
 */
export function SessionSwitcherList({
  sessions,
  isLoading,
  error,
  selectedId,
  onSelect,
  autoFocusFilter,
}: SessionSwitcherListProps) {
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matching = needle
      ? sessions.filter(
          (s) => s.name.toLowerCase().includes(needle) || s.serverProfile.name.toLowerCase().includes(needle),
        )
      : sessions;
    return groupByServer(matching);
  }, [sessions, filter]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <TextField
        size="small"
        placeholder="Filter"
        value={filter}
        autoFocus={autoFocusFilter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        slotProps={{
          htmlInput: { 'aria-label': 'Filter sessions' },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
        sx={{ mx: 1, mb: 1 }}
      />
      {error && (
        <Typography variant="body2" color="error" sx={{ px: 2 }}>
          {error}
        </Typography>
      )}
      {!isLoading && !error && groups.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2 }}>
          {filter ? 'No matching sessions' : 'No active sessions'}
        </Typography>
      )}
      <List dense disablePadding aria-label="Sessions" sx={{ overflowY: 'auto', minHeight: 0 }}>
        {groups.map((group) => (
          <li key={group.server}>
            <ul style={{ padding: 0 }}>
              <ListSubheader
                disableSticky
                sx={{ lineHeight: '28px', fontFamily: 'monospace', fontSize: 11, bgcolor: 'transparent' }}
              >
                {group.server}
              </ListSubheader>
              {group.sessions.map((session) => (
                <ListItemButton
                  key={session.id}
                  selected={session.id === selectedId}
                  aria-current={session.id === selectedId ? 'page' : undefined}
                  onClick={() => onSelect(session.id)}
                  sx={{ borderRadius: 1, mx: 0.5, minHeight: 40, gap: 1 }}
                >
                  <Box
                    component="span"
                    aria-label={session.status}
                    sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: STATUS_COLOR[session.status] }}
                  />
                  <ListItemText
                    primary={session.name}
                    slotProps={{ primary: { noWrap: true, variant: 'body2' } }}
                  />
                </ListItemButton>
              ))}
            </ul>
          </li>
        ))}
      </List>
    </Box>
  );
}
