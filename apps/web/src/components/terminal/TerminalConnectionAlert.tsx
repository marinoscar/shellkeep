import { useCallback } from 'react';
import { Alert, Box, Button } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@marinoscar/platform-web/identity/headless';
import { EXPIRED_MESSAGE, FORBIDDEN_MESSAGE, MAINTENANCE_MESSAGE } from '../../services/terminal-ws';

interface TerminalConnectionAlertProps {
  /** The terminal's error (`TerminalView`'s `onError`), or `null` for none. */
  error: string | null;
  /** Hide a recoverable error; the final ones (expired, forbidden) cannot be dismissed. */
  onDismiss?: () => void;
  /** Open a fresh socket; offered on the maintenance refusal (#46). */
  onRetry?: () => void;
}

/**
 * The terminal's connection error, shown over the top of the terminal (issue
 * #93). It is absolutely positioned inside the terminal's area, so it never
 * changes the full-bleed layout, the key shortcuts bar or the keyboard inset.
 *
 * - Expired session: "Sign in again" ends the dead session and opens the login
 *   page, which returns to this terminal after sign-in.
 * - Forbidden: the role cannot open a terminal; "Back to sessions".
 * - Maintenance (#46): a window is open and the gateway refuses new sessions;
 *   the socket does not reconnect by itself, and "Retry" tries once more.
 * - Anything else: a dismissible error; a later successful connect clears it.
 */
export function TerminalConnectionAlert({ error, onDismiss, onRetry }: TerminalConnectionAlertProps) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSignIn = useCallback(async () => {
    const from = { pathname: location.pathname, search: location.search };
    // Clear the dead session first: with it still held, the login page would
    // send the user straight back to a terminal that cannot authenticate.
    await logout();
    navigate('/login', { replace: true, state: { from } });
  }, [logout, navigate, location.pathname, location.search]);

  if (!error) return null;

  const expired = error === EXPIRED_MESSAGE;
  const forbidden = error === FORBIDDEN_MESSAGE;
  const maintenance = error === MAINTENANCE_MESSAGE;

  let action;
  if (expired) {
    action = (
      <Button color="inherit" size="small" onClick={() => void handleSignIn()}>
        Sign in again
      </Button>
    );
  } else if (maintenance) {
    action = onRetry ? (
      <Button color="inherit" size="small" onClick={onRetry}>
        Retry
      </Button>
    ) : undefined;
  } else if (forbidden) {
    action = (
      <Button color="inherit" size="small" onClick={() => navigate('/sessions')}>
        Back to sessions
      </Button>
    );
  }

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 8,
        left: 8,
        right: 8,
        zIndex: 5,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <Alert
        data-testid="terminal-connection-alert"
        data-variant={maintenance ? 'maintenance' : expired ? 'expired' : forbidden ? 'forbidden' : 'error'}
        severity={maintenance ? 'info' : forbidden ? 'warning' : 'error'}
        variant="filled"
        action={action}
        onClose={expired || forbidden || maintenance ? undefined : onDismiss}
        sx={{ pointerEvents: 'auto', maxWidth: 640, width: '100%', boxShadow: 3 }}
      >
        {error}
      </Alert>
    </Box>
  );
}
