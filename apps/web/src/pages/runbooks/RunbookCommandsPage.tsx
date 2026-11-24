/**
 * The org-wide runbook command log (#67) at `/runs/commands`: every command runbooks ran on the
 * servers the viewer may see, newest first, filtered by server, run and a time window ("what ran
 * on server X last week"). The run view's matrix links here per server (`?serverId=`).
 */
import { useState } from 'react';
import { Box, Breadcrumbs, Link, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { DataTable } from '@marinoscar/platform-web/datatable/ui';
import type { DataTableColumn } from '@marinoscar/platform-web/datatable/headless';
import { listRunbookCommands } from '../../features/runbooks/api/runbooksApi';
import type { RunbookCommandRow } from '../../features/runbooks/api/types';
import { useAsync } from '../../features/runbooks/hooks/useAsync';
import { formatDuration } from '../../features/runbooks/lib/format';

/** `<input type="date">` value to an ISO instant (start of that day, local time). */
const dayToIso = (day: string, endOfDay = false): string | undefined =>
  day ? new Date(`${day}T${endOfDay ? '23:59:59.999' : '00:00:00'}`).toISOString() : undefined;

export default function RunbookCommandsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const serverId = searchParams.get('serverId') ?? undefined;
  const runId = searchParams.get('runId') ?? undefined;
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const commands = useAsync(
    () => listRunbookCommands({ serverId, runId, from: dayToIso(from), to: dayToIso(to, true), page, pageSize }),
    [serverId, runId, from, to, page, pageSize],
  );
  const serverName = commands.data?.items.find((c) => c.serverProfileId === serverId)?.serverName;

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  const columns: DataTableColumn<RunbookCommandRow>[] = [
    { id: 'at', label: 'When', priority: 'primary', value: (r) => new Date(r.at).toLocaleString(), minWidth: 170 },
    {
      id: 'command',
      label: 'Command',
      priority: 'primary',
      value: (r) => r.commandPreview ?? '',
      render: (r) => (
        <Box component="code" sx={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {r.commandPreview}
        </Box>
      ),
      flex: 3,
      minWidth: 240,
    },
    { id: 'server', label: 'Server', priority: 'secondary', value: (r) => r.serverName ?? '' },
    {
      id: 'run',
      label: 'Run',
      priority: 'secondary',
      value: (r) => r.runbookName,
      render: (r) => (
        <Link component={RouterLink} to={`/runs/${r.runId}`}>
          {r.runbookName}
        </Link>
      ),
    },
    { id: 'origin', label: 'Origin', priority: 'detail', value: (r) => r.origin ?? '' },
    {
      id: 'outcome',
      label: 'Outcome',
      priority: 'secondary',
      value: (r) => [r.outcome, r.exitCode !== null ? `exit ${r.exitCode}` : ''].filter(Boolean).join(' · '),
    },
    { id: 'duration', label: 'Duration', priority: 'detail', value: (r) => formatDuration(r.durationMs) },
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1400, mx: 'auto', minWidth: 0 }}>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/runs" underline="hover">
          Runs
        </Link>
        <Typography color="text.primary">Commands</Typography>
      </Breadcrumbs>
      <Typography variant="h4" component="h1">
        Commands
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        {serverId ? `What runbooks ran on ${serverName ?? 'this server'}` : 'What runbooks ran on your servers'}, newest first. Previews are
        redacted; output is never stored here.
      </Typography>
      <Stack useFlexGap direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 2 }}>
        <TextField type="date" size="small" label="From" value={from} onChange={(e) => setParam('from', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField type="date" size="small" label="To" value={to} onChange={(e) => setParam('to', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        {serverId && (
          <Link component="button" type="button" onClick={() => setParam('serverId', '')} sx={{ alignSelf: 'center' }}>
            All servers
          </Link>
        )}
      </Stack>
      <DataTable<RunbookCommandRow>
        tableId="runbook-commands"
        ariaLabel="Commands"
        columns={columns}
        rows={commands.data?.items ?? []}
        rowId={(r) => r.id}
        loading={commands.loading}
        error={commands.error}
        disableExport
        emptyState={<Typography variant="body2">No commands match.</Typography>}
        pagination={{
          page: page - 1,
          pageSize,
          total: commands.data?.total ?? 0,
          onPaginationChange: (next) => {
            setPage(next.page + 1);
            setPageSize(next.pageSize);
          },
        }}
      />
    </Box>
  );
}
