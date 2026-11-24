/**
 * A profile's host-key trust state as an icon plus text (issue #60), never
 * colour alone: a filled shield and "Trusted", an outlined shield and
 * "Not trusted", or a crossed shield and "Mismatch" while the last test was
 * refused for a changed key (#79). The tooltip carries the fingerprint.
 */

import { Box, Chip, Tooltip, Typography } from '@mui/material';
import {
  GppBad as MismatchIcon,
  RemoveModerator as UntrustedIcon,
  VerifiedUser as TrustedIcon,
} from '@mui/icons-material';
import { algorithmLabel, isHostKeyTrusted } from '../../lib/terminal/host-key';
import type { ServerProfile } from '../../types/terminal';

type Profile = Pick<ServerProfile, 'fingerprint' | 'hostKeyAlgorithm'> & Partial<Pick<ServerProfile, 'hostKeyState'>>;

/** The compact form used in the server list row. */
export function HostKeyStatus({ profile }: { profile: Profile }) {
  const trusted = isHostKeyTrusted(profile);
  // The last connection test was refused for a changed key (#79): say so, never only by colour.
  if (trusted && profile.hostKeyState === 'mismatch') {
    return (
      <Tooltip title={`The server presented a different key than the trusted ${profile.fingerprint}. Verify it before connecting.`}>
        <Box
          data-testid="host-key-status"
          data-trusted="mismatch"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap' }}
        >
          <MismatchIcon fontSize="small" color="error" aria-hidden />
          <Typography variant="body2" component="span">
            Mismatch
          </Typography>
        </Box>
      </Tooltip>
    );
  }
  const label = trusted ? 'Trusted' : 'Not trusted';
  const tooltip = trusted
    ? `${algorithmLabel(profile.hostKeyAlgorithm)} ${profile.fingerprint}`
    : 'No host key is trusted yet. The next connection asks you to verify it.';
  return (
    <Tooltip title={tooltip}>
      <Box
        data-testid="host-key-status"
        data-trusted={trusted ? 'true' : 'false'}
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap' }}
      >
        {trusted ? (
          <TrustedIcon fontSize="small" color="success" aria-hidden />
        ) : (
          <UntrustedIcon fontSize="small" sx={{ color: 'text.secondary' }} aria-hidden />
        )}
        <Typography variant="body2" component="span">
          {label}
        </Typography>
      </Box>
    </Tooltip>
  );
}

/** The chip used in the profile form: Trusted / Not trusted, or "—" before the profile exists. */
export function HostKeyStatusChip({ profile }: { profile: Profile | null }) {
  if (!profile) {
    return <Chip size="small" label="—" aria-label="Host key status unknown" />;
  }
  const trusted = isHostKeyTrusted(profile);
  return (
    <Chip
      size="small"
      data-testid="host-key-chip"
      icon={trusted ? <TrustedIcon aria-hidden /> : <UntrustedIcon aria-hidden />}
      label={trusted ? 'Trusted' : 'Not trusted'}
      color={trusted ? 'success' : 'default'}
      variant={trusted ? 'filled' : 'outlined'}
    />
  );
}
