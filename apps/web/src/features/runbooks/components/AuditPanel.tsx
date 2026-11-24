/**
 * A run's audit trail (#67): the lifecycle events and every command the run executed, oldest
 * first, with Export CSV and Export JSON (the API's streamed, formula-safe files). A command row
 * carries its redacted preview and sha256, never output.
 */
import { useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { DataTable } from '@marinoscar/platform-web/datatable/ui';
import type { DataTableColumn } from '@marinoscar/platform-web/datatable/headless';
import { downloadRunAudit, getRunAudit } from '../api/runbooksApi';
import type { RunAuditItem } from '../api/types';
import { errorMessage, useAsync } from '../hooks/useAsync';
import { formatDuration } from '../lib/format';

const EVENT_LABELS: Record<string, string> = {
  'run.created': 'Run created',
  'run.destructive_confirmed': 'Destructive run confirmed',
  'run.started': 'Run started',
  'approval.requested': 'Approval requested',
  'approval.decided': 'Approval decided',
  'run.cancel_requested': 'Cancel requested',
  'target.cancelled': 'Server cancelled',
  'run.finished': 'Run finished',
};

/** A stable row id: the API's items have none. */
const rowId = (item: RunAuditItem, index: number) => `${item.at}-${item.kind}-${item.commandSha256 ?? item.event ?? ''}-${index}`;

export function AuditPanel({ runId }: { runId: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(200);
  const [exportError, setExportError] = useState<string | null>(null);
  const audit = useAsync(() => getRunAudit(runId, page, pageSize), [runId, page, pageSize]);
  const items = (audit.data?.items ?? []).map((item, index) => ({ ...item, _id: rowId(item, index) }));

  const columns: DataTableColumn<(typeof items)[number]>[] = [
    { id: 'at', label: 'When', priority: 'primary', value: (r) => new Date(r.at).toLocaleString(), minWidth: 170 },
    {
      id: 'what',
      label: 'What',
      priority: 'primary',
      value: (r) => (r.kind === 'event' ? EVENT_LABELS[r.event ?? ''] ?? r.event ?? '' : r.commandPreview ?? ''),
      render: (r) =>
        r.kind === 'event' ? (
          <Typography variant="body2">{EVENT_LABELS[r.event ?? ''] ?? r.event}{r.detail ? ` · ${r.detail}` : ''}</Typography>
        ) : (
          <Box component="code" sx={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {r.commandPreview}
          </Box>
        ),
      flex: 3,
      minWidth: 240,
    },
    { id: 'server', label: 'Server', priority: 'secondary', value: (r) => r.serverName ?? '' },
    { id: 'step', label: 'Step', priority: 'secondary', value: (r) => (r.stepIndex === null ? '' : `${r.stepIndex + 1}. ${r.stepName ?? ''}`) },
    { id: 'origin', label: 'Origin', priority: 'detail', value: (r) => r.origin ?? '' },
    {
      id: 'outcome',
      label: 'Outcome',
      priority: 'secondary',
      value: (r) =>
        [r.outcome, r.exitCode !== null && r.exitCode !== undefined ? `exit ${r.exitCode}` : '', r.timedOut ? 'timed out' : '']
          .filter(Boolean)
          .join(' · '),
    },
    { id: 'duration', label: 'Duration', priority: 'detail', value: (r) => formatDuration(r.durationMs) },
    { id: 'sha', label: 'sha256', priority: 'detail', value: (r) => (r.commandSha256 ? r.commandSha256.slice(0, 12) : '') },
  ];

  const exportAs = async (format: 'csv' | 'json') => {
    setExportError(null);
    try {
      await downloadRunAudit(runId, format);
    } catch (err) {
      setExportError(errorMessage(err, 'The export failed'));
    }
  };

  return (
    <Stack spacing={2} component="section" aria-label="Audit trail">
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', flex: 1, minWidth: 200 }}>
          {audit.data ? `${audit.data.events} events · ${audit.data.commands} commands` : ' '}
        </Typography>
        <Button startIcon={<DownloadIcon />} variant="outlined" size="small" onClick={() => void exportAs('csv')}>
          Export CSV
        </Button>
        <Button startIcon={<DownloadIcon />} variant="outlined" size="small" onClick={() => void exportAs('json')}>
          Export JSON
        </Button>
      </Stack>
      {exportError && <Alert severity="error">{exportError}</Alert>}
      <DataTable
        tableId="runbook-run-audit"
        ariaLabel="Audit trail"
        columns={columns}
        rows={items}
        rowId={(r) => r._id}
        loading={audit.loading}
        error={audit.error}
        disableExport
        emptyState={<Typography variant="body2">Nothing recorded yet.</Typography>}
        pagination={{
          page: page - 1,
          pageSize,
          total: audit.data?.total ?? 0,
          pageSizeOptions: [50, 200, 1000],
          onPaginationChange: (next) => {
            setPage(next.page + 1);
            setPageSize(next.pageSize);
          },
        }}
      />
    </Stack>
  );
}
