/**
 * The Runbooks list (issue #65, Subtask A): a `DataTable` of the runbooks the viewer may see
 * (name, tags, step kinds, version, last run, owner), with search, a tag filter, a
 * Mine / Shared with me filter (#71) and an "Archived" toggle. Row actions are hidden without
 * the permission (`runbooks:run`, `runbooks:write`) or the record's `access.can`; the API still
 * enforces both.
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  FormControlLabel,
  Link,
  Snackbar,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import UnarchiveOutlinedIcon from '@mui/icons-material/UnarchiveOutlined';
import HowToRegOutlinedIcon from '@mui/icons-material/HowToRegOutlined';
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { DataTable } from '@marinoscar/platform-web/datatable/ui';
import type { DataTableColumn, DataTableRowAction } from '@marinoscar/platform-web/datatable/headless';
import {
  archiveRunbook,
  createRunbook,
  getRunbook,
  listRunbooks,
  restoreRunbook,
  type RunbooksFilter,
} from '../../features/runbooks/api/runbooksApi';
import type { RunbookListItem } from '../../features/runbooks/api/types';
import { errorMessage, useAsync } from '../../features/runbooks/hooks/useAsync';
import { usePendingApprovalCount } from '../../features/runbooks/hooks/usePendingApprovalCount';
import { OwnerChip } from '../../features/runbooks/components/OwnerChip';
import { StatusChip } from '../../features/runbooks/components/StatusChip';
import { StepKindIcons } from '../../features/runbooks/components/StepKindIcons';
import { RunLauncherDialog } from '../../features/runbooks/components/RunLauncherDialog';
import { relativeTime } from '../../components/home/relativeTime';

export default function RunbooksPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission('runbooks:write');
  const canRun = hasPermission('runbooks:run');
  const pendingApprovals = usePendingApprovalCount();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const filter = (searchParams.get('filter') as RunbooksFilter | null) ?? 'all';
  const [launch, setLaunch] = useState<RunbookListItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const list = useAsync(
    () => listRunbooks({ page, pageSize, q: search || undefined, tag: tag || undefined, includeArchived, filter }),
    [page, pageSize, search, tag, includeArchived, filter],
  );

  const rows = list.data?.items ?? [];
  const knownTags = useMemo(() => [...new Set(rows.flatMap((r) => r.tags))].sort(), [rows]);

  const setFilter = (next: RunbooksFilter) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('filter');
    else params.set('filter', next);
    setSearchParams(params, { replace: true });
    setPage(1);
  };

  const duplicate = async (row: RunbookListItem) => {
    setActionError(null);
    try {
      const detail = await getRunbook(row.id);
      if (!detail.latestVersion) throw new Error('This runbook has no version to copy');
      const copy = await createRunbook({
        name: `${row.name} (copy)`.slice(0, 120),
        description: row.description ?? undefined,
        tags: row.tags,
        definition: detail.latestVersion.definition,
        changelog: `Copied from ${row.name} v${detail.latestVersion.version}`,
      });
      navigate(`/runbooks/${copy.id}/edit`);
    } catch (err) {
      setActionError(errorMessage(err, 'Could not duplicate the runbook'));
    }
  };

  const toggleArchive = async (row: RunbookListItem) => {
    setActionError(null);
    try {
      if (row.archivedAt) await restoreRunbook(row.id);
      else await archiveRunbook(row.id);
      setNotice(row.archivedAt ? `Restored "${row.name}"` : `Archived "${row.name}"`);
      await list.reload();
    } catch (err) {
      setActionError(errorMessage(err, 'Could not change the runbook'));
    }
  };

  const columns: DataTableColumn<RunbookListItem>[] = [
    {
      id: 'name',
      label: 'Name',
      priority: 'primary',
      value: (r) => r.name,
      render: (r) => (
        <Box sx={{ minWidth: 0 }}>
          <Link component={RouterLink} to={`/runbooks/${r.id}`} underline="hover" sx={{ fontWeight: 600 }}>
            {r.name}
          </Link>
          {r.archivedAt && <Chip size="small" label="Archived" sx={{ ml: 1 }} />}
        </Box>
      ),
      flex: 2,
      minWidth: 180,
    },
    {
      id: 'tags',
      label: 'Tags',
      priority: 'secondary',
      value: (r) => r.tags.join(', '),
      render: (r) => (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {r.tags.map((t) => (
            <Chip key={t} size="small" label={t} />
          ))}
        </Box>
      ),
      flex: 1,
    },
    {
      id: 'steps',
      label: 'Steps',
      priority: 'secondary',
      value: (r) => r.stepKinds.length,
      render: (r) => <StepKindIcons kinds={r.stepKinds} />,
      minWidth: 140,
    },
    {
      id: 'version',
      label: 'Version',
      priority: 'secondary',
      value: (r) => r.latestVersion?.version ?? null,
      render: (r) => (r.latestVersion ? `v${r.latestVersion.version}` : '—'),
      width: 90,
    },
    {
      id: 'lastRun',
      label: 'Last run',
      priority: 'secondary',
      value: (r) => r.lastRun?.status ?? 'never',
      render: (r) =>
        r.lastRun ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Link component={RouterLink} to={`/runs/${r.lastRun.id}`} aria-label={`Last run ${r.lastRun.status}`}>
              <StatusChip status={r.lastRun.status} />
            </Link>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {relativeTime(r.lastRun.createdAt)}
            </Typography>
          </Box>
        ) : (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Never
          </Typography>
        ),
      minWidth: 190,
    },
    {
      id: 'owner',
      label: 'Owner',
      priority: 'detail',
      value: (r) => r.owner.name ?? '',
      render: (r) => <OwnerChip owner={r.owner} access={r.access} />,
      minWidth: 150,
    },
  ];

  const rowActions: DataTableRowAction<RunbookListItem>[] = [
    ...(canRun
      ? [
          {
            id: 'run',
            label: 'Run',
            icon: <PlayArrowIcon fontSize="small" />,
            onClick: (r: RunbookListItem) => setLaunch(r),
            disabled: (r: RunbookListItem) => !r.access.can.run || Boolean(r.archivedAt) || !r.latestVersion,
            disabledReason: (r: RunbookListItem) =>
              r.archivedAt ? 'Restore it first' : !r.access.can.run ? 'You may view this runbook, not run it' : undefined,
          },
        ]
      : []),
    ...(canWrite
      ? [
          {
            id: 'edit',
            label: 'Edit',
            icon: <EditOutlinedIcon fontSize="small" />,
            onClick: (r: RunbookListItem) => navigate(`/runbooks/${r.id}/edit`),
            disabled: (r: RunbookListItem) => !r.access.can.write || Boolean(r.archivedAt),
          },
          {
            id: 'duplicate',
            label: 'Duplicate',
            icon: <ContentCopyIcon fontSize="small" />,
            onClick: (r: RunbookListItem) => void duplicate(r),
            disabled: (r: RunbookListItem) => !r.latestVersion,
          },
          {
            id: 'archive',
            label: 'Archive or restore',
            icon: <ArchiveOutlinedIcon fontSize="small" />,
            onClick: (r: RunbookListItem) => void toggleArchive(r),
            disabled: (r: RunbookListItem) => !r.access.can.write,
            confirm: {
              title: 'Archive or restore this runbook?',
              description: (r: RunbookListItem) =>
                r.archivedAt ? `"${r.name}" becomes runnable again.` : `"${r.name}" can no longer be run; its runs and versions stay.`,
            },
          },
        ]
      : []),
  ];

  const hasQuery = Boolean(search || tag || includeArchived || filter !== 'all');
  const emptyState = hasQuery ? (
    <Typography variant="body2">No runbooks match.</Typography>
  ) : (
    <Box sx={{ textAlign: 'center', py: 4 }}>
      <PlaylistPlayIcon sx={{ fontSize: 48, color: 'text.disabled' }} aria-hidden="true" />
      <Typography variant="h6" component="p" sx={{ mt: 1 }}>
        No runbooks yet
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        A runbook is a reusable, versioned procedure you can run on many servers at once.
      </Typography>
      {canWrite && (
        <Button variant="contained" startIcon={<AddIcon />} component={RouterLink} to="/runbooks/new">
          Create runbook
        </Button>
      )}
      {/* TODO(#64): "Draft with AI" (shown while AI is on) once the drafting route ships. */}
    </Box>
  );

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1400, mx: 'auto', minWidth: 0 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h4" component="h1">
            Runbooks
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Versioned procedures to run on your fleet.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 1 }}>
          <Button component={RouterLink} to="/runs" variant="outlined">
            Runs
          </Button>
          <Badge badgeContent={pendingApprovals} color="warning" max={99}>
            <Button
              component={RouterLink}
              to="/runbooks/approvals"
              variant="outlined"
              startIcon={<HowToRegOutlinedIcon />}
              aria-label={pendingApprovals > 0 ? `Approvals, ${pendingApprovals} pending` : 'Approvals'}
            >
              Approvals
            </Button>
          </Badge>
          {canWrite && (
            <Button component={RouterLink} to="/runbooks/new" variant="contained" startIcon={<AddIcon />}>
              Create runbook
            </Button>
          )}
        </Stack>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2, alignItems: { md: 'center' } }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={filter}
          onChange={(_e, next) => next && setFilter(next)}
          aria-label="Which runbooks"
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="mine">Mine</ToggleButton>
          <ToggleButton value="shared">Shared with me</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          select={knownTags.length > 0}
          size="small"
          label="Tag"
          value={tag}
          onChange={(e) => {
            setTag(e.target.value);
            setPage(1);
          }}
          sx={{ minWidth: 160 }}
          slotProps={knownTags.length > 0 ? { select: { native: true } } : undefined}
        >
          {knownTags.length > 0 && [
            <option key="" value="">
              Any tag
            </option>,
            ...knownTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            )),
          ]}
        </TextField>
        <FormControlLabel
          control={
            <Switch
              checked={includeArchived}
              onChange={(e) => {
                setIncludeArchived(e.target.checked);
                setPage(1);
              }}
            />
          }
          label={
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
              <UnarchiveOutlinedIcon fontSize="small" aria-hidden="true" /> Archived
            </Box>
          }
        />
      </Stack>

      {actionError && (
        <Alert severity="error" onClose={() => setActionError(null)} sx={{ mb: 2 }}>
          {actionError}
        </Alert>
      )}

      <DataTable<RunbookListItem>
        tableId="runbooks"
        ariaLabel="Runbooks"
        columns={columns}
        rows={rows}
        rowId={(r) => r.id}
        loading={list.loading}
        error={list.error}
        emptyState={emptyState}
        disableExport
        quickSearch={{
          value: search,
          onChange: (next) => {
            setSearch(next);
            setPage(1);
          },
          placeholder: 'Search runbooks',
          ariaLabel: 'Search runbooks',
        }}
        pagination={{
          // The table's page is zero-based; the API's is one-based.
          page: page - 1,
          pageSize,
          total: list.data?.total ?? 0,
          onPaginationChange: (next) => {
            setPage(next.page + 1);
            setPageSize(next.pageSize);
          },
        }}
        rowActions={rowActions}
      />

      {launch && <RunLauncherDialog open runbookId={launch.id} onClose={() => setLaunch(null)} />}
      <Snackbar open={Boolean(notice)} autoHideDuration={4000} onClose={() => setNotice(null)} message={notice ?? ''} />
    </Box>
  );
}
