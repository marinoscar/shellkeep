/**
 * The host-key trust dialog (issue #60).
 *
 * Opened wherever the SSH layer refused a host key before sending any
 * credential: the terminal socket, a test connection, a scan in the profile
 * form. Two states:
 *
 * - **Unknown** (`HOST_KEY_UNKNOWN`): first contact. Shows the presented key's
 *   algorithm and fingerprint and the command to compare it on the server;
 *   "Trust and connect" trusts exactly that fingerprint.
 * - **Mismatch** (`HOST_KEY_MISMATCH`): the server presents a different key
 *   than the trusted one. Shows both side by side; "Cancel" is the default and
 *   focused. "Replace trusted key…" (only with `servers:write`) opens a
 *   confirmation that requires typing the profile's hostname.
 *
 * The API re-scans before storing: if the server's key changed between the
 * prompt and the click it answers 409 `HOST_KEY_CHANGED_DURING_TRUST`, and the
 * dialog shows the new key for the user to compare again.
 */

import { useEffect, useId, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  GppMaybe as MismatchIcon,
  VpnKey as KeyIcon,
} from '@mui/icons-material';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { ApiError } from '../../services/api';
import { getServerProfile, trustHostKey } from '../../services/terminal-api';
import { algorithmLabel, sshKeygenHint } from '../../lib/terminal/host-key';
import type { HostKeyRefusal, PresentedHostKey, ServerProfile } from '../../types/terminal';

export const HOST_KEY_MISMATCH_TITLE = 'Host key changed — possible interception';
export const HOST_KEY_UNKNOWN_TITLE = 'Verify the host key';

export interface HostKeyDialogProps {
  /** The refusal to resolve; the dialog is open while it is set. */
  refusal: HostKeyRefusal | null;
  /** The profile's hostname, when the caller has it (else it is fetched). */
  hostname?: string;
  /** The label of the trust button in the unknown state. */
  trustLabel?: string;
  /** Called with the updated profile once the key is trusted. */
  onTrusted: (profile: ServerProfile) => void;
  /** Called when the user leaves without trusting. */
  onCancel: () => void;
}

const monoSx = {
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  fontSize: '0.85rem',
  wordBreak: 'break-all' as const,
};

function Fingerprint({ label, hostKey, testId }: { label: string; hostKey: PresentedHostKey | string | null; testId: string }) {
  const fingerprint = typeof hostKey === 'string' ? hostKey : hostKey?.fingerprint;
  const algorithm = typeof hostKey === 'string' || !hostKey ? null : hostKey.algorithm;
  return (
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
        {label}
        {algorithm ? ` · ${algorithmLabel(algorithm)}` : ''}
      </Typography>
      <Typography data-testid={testId} sx={monoSx}>
        {fingerprint ?? '—'}
      </Typography>
    </Box>
  );
}

function KeygenHint({ algorithm }: { algorithm: string | null }) {
  const hint = sshKeygenHint(algorithm);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hint);
      setCopied(true);
    } catch {
      // Clipboard unavailable (insecure origin, denied): the text stays selectable.
    }
  };
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Compare it with the fingerprint shown on the server:
      </Typography>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mt: 0.5,
          px: 1.5,
          py: 0.5,
          borderRadius: 1,
          bgcolor: 'action.hover',
        }}
      >
        <Typography component="code" data-testid="host-key-hint" sx={{ ...monoSx, flex: 1 }}>
          {hint}
        </Typography>
        <Tooltip title={copied ? 'Copied' : 'Copy command'}>
          <IconButton size="small" aria-label="Copy command" onClick={() => void copy()}>
            <CopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'HOST_KEY_CONFIRMATION_REQUIRED') {
      return 'Type the server hostname exactly to replace the trusted key.';
    }
    if (error.status === 502) return `The server could not be reached: ${error.message}`;
    return error.message;
  }
  return error instanceof Error ? error.message : 'Failed to trust the host key';
}

export function HostKeyDialog({
  refusal,
  hostname: hostnameProp,
  trustLabel = 'Trust and connect',
  onTrusted,
  onCancel,
}: HostKeyDialogProps) {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission('servers:write');
  const titleId = useId();
  const confirmTitleId = useId();

  /** The key shown; replaced when the server's key changed during trust (409). */
  const [presentedOverride, setPresented] = useState<PresentedHostKey | null>(null);
  const [hostname, setHostname] = useState<string | undefined>(hostnameProp);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changedNotice, setChangedNotice] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState('');

  // A new refusal starts from a clean state.
  useEffect(() => {
    setPresented(null);
    setBusy(false);
    setError(null);
    setChangedNotice(false);
    setConfirmOpen(false);
    setTyped('');
  }, [refusal]);

  // The mismatch confirmation compares against the profile's hostname.
  useEffect(() => {
    setHostname(hostnameProp);
    if (hostnameProp || !refusal) return;
    let cancelled = false;
    getServerProfile(refusal.serverProfileId)
      .then((profile) => {
        if (!cancelled) setHostname(profile.hostname);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hostnameProp, refusal]);

  const presented = presentedOverride ?? refusal?.presented ?? null;
  if (!refusal || !presented) return null;
  const mismatch = refusal.code === 'HOST_KEY_MISMATCH';

  const trust = async (confirmHostname?: string) => {
    setBusy(true);
    setError(null);
    try {
      const profile = await trustHostKey(refusal.serverProfileId, presented.fingerprint, confirmHostname);
      setConfirmOpen(false);
      onTrusted(profile);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'HOST_KEY_CHANGED_DURING_TRUST') {
        const next = (err.details as { presented?: PresentedHostKey } | undefined)?.presented;
        if (next?.fingerprint) setPresented(next);
        setChangedNotice(true);
        setConfirmOpen(false);
      } else {
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    if (!busy) onCancel();
  };

  const target = hostname ? <strong>{hostname}</strong> : 'this server';
  const confirmMatches = !!hostname && typed === hostname;

  return (
    <>
      <Dialog
        open
        onClose={handleCancel}
        maxWidth="sm"
        fullWidth
        aria-labelledby={titleId}
        role="alertdialog"
        data-testid="host-key-dialog"
        data-state={mismatch ? 'mismatch' : 'unknown'}
      >
        <DialogTitle
          id={titleId}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, color: mismatch ? 'error.main' : undefined }}
        >
          {mismatch ? <MismatchIcon aria-hidden /> : <KeyIcon aria-hidden color="info" />}
          {mismatch ? HOST_KEY_MISMATCH_TITLE : HOST_KEY_UNKNOWN_TITLE}
        </DialogTitle>
        <DialogContent>
          {changedNotice && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              The server now presents a different key than the one you verified. Compare the key below
              again before trusting it.
            </Alert>
          )}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {mismatch ? (
            <DialogContentText component="div">
              {target} presented a different host key than the trusted one. The server may have been
              rebuilt, or someone may be intercepting the connection. The connection was stopped and no
              credential was sent.
            </DialogContentText>
          ) : (
            <DialogContentText component="div">
              This is the first connection to {target}. ShellKeep cannot know yet whether this key really
              belongs to that server. Compare it with a fingerprint you got another way, for example from
              the server console or your provider.
            </DialogContentText>
          )}

          <Box
            sx={{
              mt: 2,
              p: 1.5,
              borderRadius: 1,
              border: 1,
              borderColor: mismatch ? 'error.main' : 'divider',
              display: 'flex',
              flexDirection: { xs: 'column', sm: mismatch ? 'row' : 'column' },
              gap: 2,
            }}
          >
            {mismatch && <Fingerprint label="Trusted (expected)" hostKey={refusal.expected} testId="host-key-expected" />}
            <Fingerprint
              label={mismatch ? 'Presented now' : 'Key fingerprint (SHA256)'}
              hostKey={presented}
              testId="host-key-presented"
            />
          </Box>

          <KeygenHint algorithm={presented.algorithm} />

          {!canWrite && (
            <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
              {mismatch
                ? 'Replacing a trusted key needs the servers:write permission.'
                : 'Trusting a key needs the servers:write permission.'}
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          {mismatch ? (
            <>
              {canWrite && (
                <Button color="error" onClick={() => setConfirmOpen(true)} disabled={busy}>
                  Replace trusted key…
                </Button>
              )}
              <Button variant="contained" onClick={handleCancel} disabled={busy} autoFocus>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button onClick={handleCancel} disabled={busy}>
                Cancel
              </Button>
              {canWrite && (
                <Button
                  variant="contained"
                  onClick={() => void trust()}
                  disabled={busy}
                  startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
                >
                  {trustLabel}
                </Button>
              )}
            </>
          )}
        </DialogActions>
      </Dialog>

      <Dialog
        open={confirmOpen}
        onClose={() => !busy && setConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
        aria-labelledby={confirmTitleId}
        data-testid="host-key-replace-confirm"
      >
        <DialogTitle id={confirmTitleId}>Replace the trusted host key?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Only replace it if you know why the key changed (for example the server was rebuilt) and the
            presented fingerprint matches the one on the server. Type the hostname
            {hostname ? (
              <>
                {' '}
                <Box component="strong" sx={monoSx}>
                  {hostname}
                </Box>
              </>
            ) : null}{' '}
            to confirm.
          </DialogContentText>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <TextField
            label="Hostname"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            fullWidth
            autoFocus
            autoComplete="off"
            disabled={busy}
            slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: 'none' } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={busy}>
            Back
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={!confirmMatches || busy}
            onClick={() => void trust(typed)}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            Replace and connect
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
