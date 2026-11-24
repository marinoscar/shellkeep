import { useState } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import type { ShellContextPaneProps } from '@marinoscar/platform-web/shell/headless';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { NewSessionDialog } from '../NewSessionDialog';
import { TERMINAL_WRITE_PERMISSION } from '../TerminalAccessGate';
import { createSession } from '../../../services/terminal-api';
import type { CreateSessionData } from '../../../types';
import { SessionSwitcherList, useSwitcherSessions } from './SessionSwitcherList';

/** The session id of a `/sessions/<id>` pathname, or `null`. */
export function sessionIdFromPath(pathname: string): string | null {
  const match = /^\/sessions\/([^/?#]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * The Sessions destination's context pane (issue #77, `contextPane` in
 * `config/destinations.ts`): the active and detached sessions grouped by
 * server, with status dots and "New session". The platform draws it beside
 * the EXPANDED rail only (`lg` and not collapsed) and keeps it mounted across
 * `/sessions/*`, so clicking a session navigates to `/sessions/<id>` and the
 * workspace opens it as a tab without a reload. Below that, the workspace
 * toolbar's `SessionSwitcherMenu` shows the same list.
 */
export function SessionSwitcherPane({ pathname }: ShellContextPaneProps) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission(TERMINAL_WRITE_PERMISSION);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { sessions, isLoading, error } = useSwitcherSessions(pathname);

  const create = async (data: CreateSessionData) => {
    const created = await createSession(data);
    navigate(`/sessions/${created.id}`);
  };

  return (
    <Box
      component="nav"
      aria-label="Session switcher"
      data-testid="session-switcher-pane"
      sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', py: 1.5 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, pb: 1 }}>
        <Typography
          variant="caption"
          sx={{ flex: 1, fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}
        >
          Sessions
        </Typography>
        {canWrite && (
          <Tooltip title="New session">
            <IconButton size="small" aria-label="New session" onClick={() => setDialogOpen(true)}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <SessionSwitcherList
        sessions={sessions}
        isLoading={isLoading}
        error={error}
        selectedId={sessionIdFromPath(pathname)}
        onSelect={(id) => navigate(`/sessions/${id}`)}
      />
      {canWrite && (
        <NewSessionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreate={create} />
      )}
    </Box>
  );
}
