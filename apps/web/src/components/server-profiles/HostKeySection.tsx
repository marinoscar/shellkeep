/**
 * The "Host key" section of the server profile form (issue #60): the trust
 * status, the trusted fingerprint, "Scan" (read the key the server presents
 * now, sending no credential) and "Forget"; and the server's probed facts
 * (OS, package manager, tmux) with "Refresh".
 *
 * Scanning a key that is not the trusted one opens the host-key dialog, so the
 * key is trusted or replaced exactly as from a terminal. Forget, trust and
 * refresh need `servers:write`; the API enforces it, the buttons follow it.
 */

import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import {
  DeleteOutlined as ForgetIcon,
  Refresh as RefreshIcon,
  Search as ScanIcon,
} from '@mui/icons-material';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { ApiError } from '../../services/api';
import { forgetHostKey, refreshServerFacts, scanHostKey } from '../../services/terminal-api';
import { algorithmLabel, factsSummary, hostKeyRefusalFromError } from '../../lib/terminal/host-key';
import type { HostKeyRefusal, ServerProfile } from '../../types/terminal';
import { HostKeyDialog } from './HostKeyDialog';
import { HostKeyStatusChip } from './HostKeyStatus';

interface HostKeySectionProps {
  profile: ServerProfile;
  /** Called with the profile after a trust, forget or facts refresh. */
  onProfileChanged?: (profile: ServerProfile) => void;
}

type Busy = 'scan' | 'forget' | 'facts' | null;

const monoSx = {
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  fontSize: '0.8rem',
  wordBreak: 'break-all' as const,
};

function message(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 502) {
    return `The server could not be reached: ${error.message}`;
  }
  return error instanceof Error ? error.message : fallback;
}

export function HostKeySection({ profile: initial, onProfileChanged }: HostKeySectionProps) {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission('servers:write');
  const [profile, setProfile] = useState(initial);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<{ severity: 'success' | 'info' | 'error'; text: string } | null>(null);
  const [refusal, setRefusal] = useState<HostKeyRefusal | null>(null);

  useEffect(() => {
    setProfile(initial);
    setNotice(null);
  }, [initial]);

  const update = (next: ServerProfile) => {
    setProfile(next);
    onProfileChanged?.(next);
  };

  const handleScan = async () => {
    setBusy('scan');
    setNotice(null);
    try {
      const result = await scanHostKey(profile.id);
      if (result.matches) {
        setNotice({ severity: 'success', text: 'The server presents the trusted key.' });
      } else {
        setRefusal({
          code: result.trusted ? 'HOST_KEY_MISMATCH' : 'HOST_KEY_UNKNOWN',
          presented: result.presented,
          expected: result.trusted?.fingerprint ?? null,
          serverProfileId: profile.id,
        });
      }
    } catch (err) {
      setNotice({ severity: 'error', text: message(err, 'Failed to scan the host key') });
    } finally {
      setBusy(null);
    }
  };

  const handleForget = async () => {
    if (!window.confirm('Forget the trusted host key? The next connection asks you to verify it again.')) {
      return;
    }
    setBusy('forget');
    setNotice(null);
    try {
      update(await forgetHostKey(profile.id));
      setNotice({ severity: 'info', text: 'Host key forgotten.' });
    } catch (err) {
      setNotice({ severity: 'error', text: message(err, 'Failed to forget the host key') });
    } finally {
      setBusy(null);
    }
  };

  const handleRefreshFacts = async () => {
    setBusy('facts');
    setNotice(null);
    try {
      const result = await refreshServerFacts(profile.id);
      update({ ...profile, facts: result.facts, factsProbedAt: result.factsProbedAt });
    } catch (err) {
      const hostKey = hostKeyRefusalFromError(err, profile.id);
      if (hostKey) {
        setRefusal(hostKey);
      } else {
        setNotice({ severity: 'error', text: message(err, 'Failed to refresh the server facts') });
      }
    } finally {
      setBusy(null);
    }
  };

  const facts = factsSummary(profile.facts);
  const trustedAt = profile.hostKeyTrustedAt ? new Date(profile.hostKeyTrustedAt).toLocaleString() : null;

  return (
    <Box component="section" aria-labelledby="host-key-section-title" sx={{ mt: 3 }} data-testid="host-key-section">
      <Divider sx={{ mb: 2 }} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <Typography id="host-key-section-title" variant="subtitle1" component="h3">
          Host key
        </Typography>
        <HostKeyStatusChip profile={profile} />
      </Box>
      {profile.fingerprint ? (
        <>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {algorithmLabel(profile.hostKeyAlgorithm)} fingerprint
          </Typography>
          <Typography sx={monoSx} data-testid="host-key-fingerprint">
            {profile.fingerprint}
          </Typography>
          {trustedAt && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Trusted {trustedAt}
            </Typography>
          )}
        </>
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          No host key is trusted yet. Scan to verify it now, or verify it on the first connection.
        </Typography>
      )}

      {notice && (
        <Alert severity={notice.severity} sx={{ mt: 1 }} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
        <Button
          size="small"
          startIcon={busy === 'scan' ? <CircularProgress size={14} /> : <ScanIcon />}
          onClick={() => void handleScan()}
          disabled={busy !== null}
        >
          Scan
        </Button>
        {canWrite && profile.fingerprint && (
          <Button
            size="small"
            color="error"
            startIcon={busy === 'forget' ? <CircularProgress size={14} /> : <ForgetIcon />}
            onClick={() => void handleForget()}
            disabled={busy !== null}
          >
            Forget
          </Button>
        )}
      </Stack>

      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
          Server
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="body2" data-testid="server-facts">
            {facts.length > 0 ? facts.join(' · ') : 'Not probed yet'}
          </Typography>
          {canWrite && (
            <Button
              size="small"
              startIcon={busy === 'facts' ? <CircularProgress size={14} /> : <RefreshIcon />}
              onClick={() => void handleRefreshFacts()}
              disabled={busy !== null}
              aria-label="Refresh server facts"
            >
              Refresh
            </Button>
          )}
        </Box>
      </Box>

      <HostKeyDialog
        refusal={refusal}
        hostname={profile.hostname}
        trustLabel="Trust key"
        onTrusted={(next) => {
          setRefusal(null);
          update(next);
          setNotice({ severity: 'success', text: 'Host key trusted.' });
        }}
        onCancel={() => setRefusal(null)}
      />
    </Box>
  );
}
