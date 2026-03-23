import { useState, useEffect } from 'react';
import { Box, Button, Chip } from '@mui/material';
import {
  Terminal as TerminalIcon,
  PauseCircle as PauseIcon,
  Dns as DnsIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { getSessions } from '../../services/api';
import { getServerProfiles } from '../../services/api';

interface SessionStatsBarProps {
  onNewSession?: () => void;
}

export function SessionStatsBar({ onNewSession }: SessionStatsBarProps) {
  const [activeSessions, setActiveSessions] = useState(0);
  const [detachedSessions, setDetachedSessions] = useState(0);
  const [totalServers, setTotalServers] = useState(0);

  useEffect(() => {
    // Fetch active sessions count
    getSessions({ status: 'active', pageSize: 1 })
      .then((res) => setActiveSessions(res.total))
      .catch(() => {});

    // Fetch detached sessions count
    getSessions({ status: 'detached', pageSize: 1 })
      .then((res) => setDetachedSessions(res.total))
      .catch(() => {});

    // Fetch server profiles count
    getServerProfiles({ pageSize: 1 })
      .then((res) => setTotalServers(res.total))
      .catch(() => {});
  }, []);

  return (
    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 3, alignItems: 'center' }}>
      <Chip
        icon={<TerminalIcon />}
        label={`${activeSessions} active session${activeSessions !== 1 ? 's' : ''}`}
        color="success"
        variant="outlined"
      />
      <Chip
        icon={<PauseIcon />}
        label={`${detachedSessions} detached`}
        color="warning"
        variant="outlined"
      />
      <Chip
        icon={<DnsIcon />}
        label={`${totalServers} server${totalServers !== 1 ? 's' : ''}`}
        variant="outlined"
      />
      {onNewSession && (
        <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={onNewSession}>
          New Session
        </Button>
      )}
    </Box>
  );
}
