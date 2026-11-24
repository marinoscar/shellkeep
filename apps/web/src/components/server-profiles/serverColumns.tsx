/**
 * The columns of the Servers page's table (#79): colour dot and name, host, username, tags, owner,
 * health with the last check, host key and last session. Sortable: name, health, last session
 * (the API sorts; the table never does). Shared by the page and its DataTable conformance run.
 */

import { Box, Chip, Link, Typography } from '@mui/material';
import type { DataTableColumn } from '@marinoscar/platform-web/datatable/headless';
import type { ServerProfile } from '../../types';
import { factsSummary } from '../../lib/terminal/host-key';
import { relativeTime } from '../../lib/servers/relativeTime';
import { HostKeyStatus } from './HostKeyStatus';
import { HEALTH_LABELS, ServerHealthStatus } from './ServerHealthStatus';
import { ServerOwnerChip } from './ServerOwnerChip';

export const HOST_KEY_LABELS = { trusted: 'Trusted', untrusted: 'Not trusted', mismatch: 'Mismatch' } as const;

function ColorDot({ color }: { color: ServerProfile['color'] }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        flexShrink: 0,
        bgcolor: (theme) => {
          const key = !color || color === 'default' ? 'primary' : color;
          return theme.palette[key].main;
        },
      }}
    />
  );
}

export interface ServerColumnsOptions {
  /** The name opens the detail drawer. */
  onOpen: (row: ServerProfile) => void;
  /** A tag chip adds that tag to the filter. */
  onTagClick: (tag: string) => void;
}

export function buildServerColumns({ onOpen, onTagClick }: ServerColumnsOptions): DataTableColumn<ServerProfile>[] {
return [
  {
    id: 'name',
    label: 'Name',
    priority: 'primary',
    sortable: true,
    hideable: false,
    minWidth: 160,
    flex: 1,
    value: (row) => row.name,
    render: (row) => (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <ColorDot color={row.color} />
        <Link
          component="button"
          type="button"
          underline="hover"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(row);
          }}
          sx={{ textAlign: 'left', overflowWrap: 'anywhere' }}
        >
          {row.name}
        </Link>
      </Box>
    ),
  },
  {
    id: 'host',
    label: 'Host',
    priority: 'secondary',
    minWidth: 160,
    flex: 1,
    value: (row) => `${row.hostname}:${row.port}`,
    render: (row) => (
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
          {row.hostname}:{row.port}
        </Typography>
        {factsSummary(row.facts).length > 0 && (
          <Typography variant="caption" component="div" data-testid="server-facts-summary" sx={{ color: 'text.secondary' }}>
            {factsSummary(row.facts).join(' · ')}
          </Typography>
        )}
      </Box>
    ),
  },
  { id: 'username', label: 'Username', priority: 'detail', value: (row) => row.username, minWidth: 100 },
  {
    id: 'tags',
    label: 'Tags',
    priority: 'secondary',
    minWidth: 140,
    value: (row) => row.tags.join(', '),
    render: (row) =>
      row.tags.length > 0 ? (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {row.tags.map((tag) => (
            <Chip
              key={tag}
              label={tag}
              size="small"
              onClick={(event) => {
                event.stopPropagation();
                onTagClick(tag);
              }}
            />
          ))}
        </Box>
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          -
        </Typography>
      ),
  },
  {
    id: 'owner',
    label: 'Owner',
    priority: 'detail',
    minWidth: 120,
    value: (row) => row.owner?.name ?? '',
    render: (row) => <ServerOwnerChip profile={row} />,
  },
  {
    id: 'health',
    label: 'Health',
    priority: 'secondary',
    sortable: true,
    minWidth: 150,
    value: (row) => HEALTH_LABELS[row.health ?? 'unknown'],
    render: (row) => <ServerHealthStatus profile={row} />,
  },
  {
    id: 'hostKey',
    label: 'Host key',
    priority: 'detail',
    minWidth: 120,
    value: (row) => HOST_KEY_LABELS[row.hostKeyState ?? (row.fingerprint ? 'trusted' : 'untrusted')],
    render: (row) => <HostKeyStatus profile={row} />,
  },
  {
    id: 'lastSession',
    label: 'Last session',
    priority: 'detail',
    sortable: true,
    minWidth: 120,
    value: (row) => row.lastSessionAt ?? '',
    render: (row) => (
      <Typography variant="body2" sx={{ color: row.lastSessionAt ? 'text.primary' : 'text.secondary' }}>
        {row.lastSessionAt ? relativeTime(row.lastSessionAt) : 'Never'}
      </Typography>
    ),
  },
];
}
