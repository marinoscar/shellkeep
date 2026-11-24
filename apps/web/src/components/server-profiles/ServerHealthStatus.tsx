/**
 * The health column of the Servers page (#79): the outcome of the last connection test, as an
 * icon plus text (never colour alone), with when it was checked.
 */

import { Box, Tooltip, Typography } from '@mui/material';
import {
  CheckCircle as ReachableIcon,
  ErrorOutlined as UnreachableIcon,
  HelpOutlined as UnknownIcon,
} from '@mui/icons-material';
import type { ServerHealth, ServerProfile } from '../../types';
import { relativeTime } from '../../lib/servers/relativeTime';

export const HEALTH_LABELS: Record<ServerHealth, string> = {
  reachable: 'Reachable',
  unreachable: 'Unreachable',
  unknown: 'Unknown',
};

/** The health of a profile; a fixture without the field is `unknown`. */
export function healthOf(profile: Pick<ServerProfile, 'health'>): ServerHealth {
  return profile.health ?? 'unknown';
}

export function ServerHealthStatus({
  profile,
  now,
}: {
  profile: Pick<ServerProfile, 'health' | 'lastTestAt'>;
  now?: Date;
}) {
  const health = healthOf(profile);
  const checked = profile.lastTestAt ? relativeTime(profile.lastTestAt, now) : null;
  const tooltip = checked
    ? `Last connection test ${checked} (${new Date(profile.lastTestAt as string).toLocaleString()})`
    : 'Not tested yet. Run "Test connection" to check it.';
  return (
    <Tooltip title={tooltip}>
      <Box
        data-testid="server-health"
        data-health={health}
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap' }}
      >
        {health === 'reachable' && <ReachableIcon fontSize="small" color="success" aria-hidden />}
        {health === 'unreachable' && <UnreachableIcon fontSize="small" color="error" aria-hidden />}
        {health === 'unknown' && <UnknownIcon fontSize="small" sx={{ color: 'text.secondary' }} aria-hidden />}
        <Typography variant="body2" component="span">
          {HEALTH_LABELS[health]}
        </Typography>
        {checked && (
          <Typography variant="caption" component="span" sx={{ color: 'text.secondary' }}>
            {checked}
          </Typography>
        )}
      </Box>
    </Tooltip>
  );
}
