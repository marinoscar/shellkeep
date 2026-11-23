import type { ReactNode } from 'react';
import { Alert, AlertTitle, Box, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';

/** The permission the terminal WebSocket gateway requires to open a terminal. */
export const TERMINAL_WRITE_PERMISSION = 'sessions:write';

interface TerminalAccessGateProps {
  /** The terminal page, rendered only for a holder of `sessions:write`. */
  children: ReactNode;
}

/**
 * Renders a terminal page only when the viewer may open one (issue #47). The
 * gateway refuses a principal without `sessions:write` (`auth_fail`,
 * `forbidden`), so a viewer gets a clear read-only message here and no socket
 * is ever opened for them. The API remains the authority; this is presentation.
 */
export function TerminalAccessGate({ children }: TerminalAccessGateProps) {
  const { hasPermission } = usePermissions();
  const navigate = useNavigate();

  if (hasPermission(TERMINAL_WRITE_PERMISSION)) return <>{children}</>;

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, maxWidth: 640, mx: 'auto' }}>
      <Alert
        severity="info"
        data-testid="terminal-read-only"
        action={
          <Button color="inherit" size="small" onClick={() => navigate('/sessions')}>
            Back to sessions
          </Button>
        }
      >
        <AlertTitle>Read-only access</AlertTitle>
        Your role can view sessions and servers but cannot open a terminal. Ask an
        administrator for terminal access.
      </Alert>
    </Box>
  );
}
