/**
 * A profile's host-key trust state as an icon plus text (issue #60), never
 * colour alone: a filled shield and "Trusted", or an outlined shield and
 * "Not trusted". The tooltip carries the fingerprint.
 */

import { Box, Chip, Tooltip, Typography } from '@mui/material';
import {
  RemoveModerator as UntrustedIcon,
  VerifiedUser as TrustedIcon,
} from '@mui/icons-material';
import { algorithmLabel, isHostKeyTrusted } from '../../lib/terminal/host-key';
import type { ServerProfile } from '../../types/terminal';

type Profile = Pick<ServerProfile, 'fingerprint' | 'hostKeyAlgorithm'>;

/** The compact form used in the server list row. */
export function HostKeyStatus({ profile }: { profile: Profile }) {
  const trusted = isHostKeyTrusted(profile);
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
