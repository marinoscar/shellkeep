import { Box, Tooltip, Typography } from '@mui/material';
import {
  VerifiedUserOutlined as TrustedIcon,
  GppMaybeOutlined as UnknownIcon,
  GppBadOutlined as MismatchIcon,
} from '@mui/icons-material';
import type { TerminalSession } from '../../../types';

/** The host-key state of a pane's server (#60): trusted, not yet trusted, or changed. */
export type HostKeyStatus = 'trusted' | 'unknown' | 'mismatch';

export interface TerminalStatusBarProps {
  /** The focused pane's session, or `null` while it loads. */
  session: TerminalSession | null;
  /** Its socket is attached to the tmux session. */
  connected: boolean;
  /** The heartbeat round trip in ms, or `null` while not measured. */
  latencyMs: number | null;
  cols: number | null;
  rows: number | null;
  /** `null` while the server profile has not been read. */
  hostKey: HostKeyStatus | null;
  /** The trusted key's `SHA256:` fingerprint, when trusted. */
  fingerprint?: string | null;
  /** The trusted key's algorithm (`ssh-ed25519`, ...), when trusted. */
  algorithm?: string | null;
  /** A phone: one short line. */
  compact?: boolean;
}

/** `SHA256:abcdefgh...xyz` → `SHA256:abcd…xyz`. Exported for tests. */
export function shortFingerprint(fingerprint: string): string {
  const [prefix, hash] = fingerprint.includes(':') ? fingerprint.split(/:(.*)/s, 2) : ['', fingerprint];
  const short = hash.length > 10 ? `${hash.slice(0, 4)}…${hash.slice(-3)}` : hash;
  return prefix ? `${prefix}:${short}` : short;
}

/** `ssh-ed25519` → `ED25519`, `ecdsa-sha2-nistp256` → `ECDSA`. Exported for tests. */
export function algorithmLabel(algorithm: string): string {
  if (algorithm.startsWith('ecdsa')) return 'ECDSA';
  return algorithm.replace(/^ssh-/, '').toUpperCase();
}

const HOST_KEY_TEXT: Record<HostKeyStatus, string> = {
  trusted: 'host key trusted',
  unknown: 'host key not trusted yet',
  mismatch: 'host key changed',
};

function Segment({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <Box
      component="span"
      aria-label={label}
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap', minWidth: 0 }}
    >
      {children}
    </Box>
  );
}

function Divider() {
  return (
    <Box component="span" aria-hidden sx={{ color: 'divider', px: 0.5 }}>
      |
    </Box>
  );
}

/**
 * The terminal status bar at the foot of the workspace (issue #77, from the
 * #75 design's option B): the focused pane's host, its connection and latency
 * (the WebSocket heartbeat's round trip), the server's host-key state (#60)
 * and the tmux session with the pty size. Display only: it holds no terminal
 * bytes, and the SSH user and host come from the session the API returned.
 */
export function TerminalStatusBar({
  session,
  connected,
  latencyMs,
  cols,
  rows,
  hostKey,
  fingerprint,
  algorithm,
  compact = false,
}: TerminalStatusBarProps) {
  const profile = session?.serverProfile;
  const host = profile
    ? compact
      ? profile.hostname
      : `${profile.username}@${profile.hostname}${profile.port === 22 ? '' : `:${profile.port}`}`
    : '';
  const connection = connected
    ? latencyMs !== null
      ? `${latencyMs} ms`
      : 'connected'
    : 'not connected';
  const KeyIcon = hostKey === 'trusted' ? TrustedIcon : hostKey === 'mismatch' ? MismatchIcon : UnknownIcon;
  const keyColor = hostKey === 'trusted' ? 'success.main' : hostKey === 'mismatch' ? 'error.main' : 'warning.main';
  const keyDetail =
    hostKey === 'trusted' && fingerprint
      ? `${algorithm ? `${algorithmLabel(algorithm)} ` : ''}${shortFingerprint(fingerprint)}`
      : null;

  return (
    <Box
      role="status"
      aria-label="Terminal status"
      data-testid="terminal-status-bar"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1.5,
        minHeight: 26,
        flexShrink: 0,
        overflow: 'hidden',
        bgcolor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
        color: 'text.secondary',
        typography: 'caption',
        fontFamily: 'monospace',
      }}
    >
      <Segment label={`Connection: ${connection}`}>
        <Box
          component="span"
          aria-hidden
          sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: connected ? 'success.main' : 'error.main' }}
        />
        <Typography component="span" variant="caption" noWrap sx={{ fontFamily: 'inherit' }}>
          {host}
        </Typography>
        <span>{compact ? `· ${connection}` : connected && latencyMs !== null ? `rtt ${latencyMs} ms` : connection}</span>
      </Segment>
      {hostKey && (
        <>
          <Divider />
          <Tooltip title={fingerprint ? `${HOST_KEY_TEXT[hostKey]}: ${fingerprint}` : HOST_KEY_TEXT[hostKey]}>
            <Segment label={`Host key: ${HOST_KEY_TEXT[hostKey]}`}>
              <KeyIcon sx={{ fontSize: 14, color: keyColor }} />
              {!compact && <span>{HOST_KEY_TEXT[hostKey]}</span>}
              {!compact && keyDetail && <span>· {keyDetail}</span>}
            </Segment>
          </Tooltip>
        </>
      )}
      {session && (
        <>
          <Divider />
          <Segment label={`tmux session ${session.tmuxSessionId}`}>
            <span>
              tmux {session.tmuxSessionId}
              {!compact && cols && rows ? ` · ${cols}×${rows}` : ''}
            </span>
          </Segment>
        </>
      )}
    </Box>
  );
}
