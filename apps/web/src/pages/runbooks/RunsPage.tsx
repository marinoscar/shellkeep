/**
 * The Runs list (issue #65, Subtask E) at `/runs`: runbook, status, trigger, servers
 * (succeeded / failed / total), initiator, started and duration, filtered by runbook, status,
 * trigger and a `since` window. The filters live in the URL, so Home's links work:
 * `/runs?status=running`, `/runs?status=failed&since=24h`.
 */
import { useState } from 'react';
import { Box, Button, Link, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { useAuth } from '@marinoscar/platform-web/identity/headless';
import { DataTable } from '@marinoscar/platform-web/datatable/ui';
import type { DataTableColumn } from '@marinoscar/platform-web/datatable/headless';
import { listRunbooks, listRuns } from '../../features/runbooks/api/runbooksApi';
import { RUN_STATUSES, type RunListItem, type RunStatus, type RunTrigger } from '../../features/runbooks/api/types';
import { useAsync } from '../../features/runbooks/hooks/useAsync';
import { StatusChip } from '../../features/runbooks/components/StatusChip';
import { elapsedMs, formatDuration } from '../../features/runbooks/lib/format';
import { statusMeta } from '../../features/runbooks/lib/statusMeta';
import { relativeTime } from '../../components/home/relativeTime';

const SINCE_OPTIONS = [
  { value: '', label: 'Any time' },
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

const isStatus = (v: string | null): v is RunStatus => v !== null && (RUN_STATUSES as readonly string[]).includes(v);
const isTrigger = (v: string | null): v is RunTrigger => v === 'manual' || v === 'api' || v === 'schedule';
const isSince = (v: string | null): v is string => v !== null && /^\d{1,4}[mhd]$/.test(v);

export default function RunsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const statusParam = searchParams.get('status');
  const triggerParam = searchParams.get('trigger');
  const sinceParam = searchParams.get('since');
  const status = isStatus(statusParam) ? statusParam : undefined;
  const trigger = isTrigger(triggerParam) ? triggerParam : undefined;
  const since = isSince(sinceParam) ? sinceParam : undefined;
  const runbookId = searchParams.get('runbookId') ?? undefined;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const runs = useAsync(() => listRuns({ page, pageSize, status, trigger, since, runbookId }), [page, pageSize, status, trigger, since, runbookId]);
  const runbooks = useAsync(() => listRunbooks({ pageSize: 100, includeArchived: true }), []);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
    setPage(1);
  };

  const columns: DataTableColumn<RunListItem>[] = [
    {
      id: 'runbook',
      label: 'Runbook',
      priority: 'primary',
      value: (r) => r.runbookName,
      render: (r) => (
        <Link component={RouterLink} to={`/runs/${r.id}`} underline="hover" sx={{ fontWeight: 600 }}>
          {r.runbookName} <span aria-hidden="true">·</span> v{r.version}
        </Link>
      ),
      flex: 2,
      minWidth: 200,
    },
    { id: 'status', label: 'Status', priority: 'primary', value: (r) => statusMeta(r.status).label, render: (r) => <StatusChip status={r.status} />, minWidth: 160 },
    { id: 'trigger', label: 'Trigger', priority: 'secondary', value: (r) => r.trigger, width: 100 },
    {
      id: 'targets',
      label: 'Servers',
      priority: 'secondary',
      value: (r) => `${r.targets.succeeded}/${r.targets.failed}/${r.targets.total}`,
      render: (r) => (
        <Typography variant="body2" aria-label={`${r.targets.succeeded} succeeded, ${r.targets.failed} failed, ${r.targets.total} total`}>
          <Box component="span" sx={{ color: 'success.main' }}>
            {r.targets.succeeded} ok
          </Box>
          {' · '}
          <Box component="span" sx={{ color: r.targets.failed ? 'error.main' : 'text.secondary' }}>
            {r.targets.failed} failed
          </Box>
          {' · '}
          {r.targets.total} total
        </Typography>
      ),
      minWidth: 190,
    },
    {
      id: 'initiator',
      label: 'Initiator',
      priority: 'detail',
      value: (r) => (r.initiatedBy && r.initiatedBy === user?.id ? 'You' : r.initiatedBy ? 'Another user' : '—'),
    },
    { id: 'started', label: 'Started', priority: 'secondary', value: (r) => relativeTime(r.startedAt ?? r.createdAt), minWidth: 110 },
    {
      id: 'duration',
      label: 'Duration',
      priority: 'detail',
      value: (r) => (r.startedAt ? formatDuration(elapsedMs(r.startedAt, r.finishedAt)) : '—'),
    },
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1400, mx: 'auto', minWidth: 0 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h4" component="h1">
            Runs
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Every runbook run you can see, newest first.
          </Typography>
        </Box>
        <Box>
          <Button component={RouterLink} to="/runbooks" variant="outlined">
            Runbooks
          </Button>
        </Box>
      </Stack>
      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 2 }}>
        <TextField select size="small" label="Runbook" value={runbookId ?? ''} onChange={(e) => setParam('runbookId', e.target.value)} sx={{ minWidth: 200, flex: { xs: '1 1 100%', sm: '0 1 auto' } }}>
          <MenuItem value="">All runbooks</MenuItem>
          {(runbooks.data?.items ?? []).map((r) => (
            <MenuItem key={r.id} value={r.id}>
              {r.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Status" value={status ?? ''} onChange={(e) => setParam('status', e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">Any status</MenuItem>
          {RUN_STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {statusMeta(s).label}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Trigger" value={trigger ?? ''} onChange={(e) => setParam('trigger', e.target.value)} sx={{ minWidth: 140 }}>
          <MenuItem value="">Any trigger</MenuItem>
          <MenuItem value="manual">Manual</MenuItem>
          <MenuItem value="api">API</MenuItem>
          <MenuItem value="schedule">Schedule</MenuItem>
        </TextField>
        <TextField select size="small" label="Started" value={since ?? ''} onChange={(e) => setParam('since', e.target.value)} sx={{ minWidth: 160 }}>
          {SINCE_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <DataTable<RunListItem>
        tableId="runbook-runs"
        ariaLabel="Runs"
        columns={columns}
        rows={runs.data?.items ?? []}
        rowId={(r) => r.id}
        loading={runs.loading}
        error={runs.error}
        disableExport
        emptyState={<Typography variant="body2">No runs match.</Typography>}
        pagination={{
          page: page - 1,
          pageSize,
          total: runs.data?.total ?? 0,
          onPaginationChange: (next) => {
            setPage(next.page + 1);
            setPageSize(next.pageSize);
          },
        }}
      />
    </Box>
  );
}
