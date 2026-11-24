/**
 * The live run view (issue #65, Subtask D) at `/runs/:id`: the header (runbook and version,
 * trigger, initiator, progress per status, elapsed time, actions), then the matrix of servers by
 * steps (a card list at phone width) and the log drawer. Live updates come from the run stream
 * through `useRunLive`, which patches the run in place and polls only if the stream fails.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  LinearProgress,
  Link,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { useAuth, usePermissions } from '@marinoscar/platform-web/identity/headless';
import { cancelRun, resumeRun, retryRun } from '../../features/runbooks/api/runbooksApi';
import type { RunDetail, RunTargetRow, TargetStatus } from '../../features/runbooks/api/types';
import { TARGET_STATUSES } from '../../features/runbooks/api/types';
import { useRunLive } from '../../features/runbooks/hooks/useRunLive';
import { errorMessage } from '../../features/runbooks/hooks/useAsync';
import { isRunFinished } from '../../features/runbooks/lib/runState';
import { elapsedMs, formatDuration } from '../../features/runbooks/lib/format';
import { statusMeta, toneColor } from '../../features/runbooks/lib/statusMeta';
import { RunMatrix } from '../../features/runbooks/components/RunMatrix';
import { RunCardList } from '../../features/runbooks/components/RunCardList';
import { LogDrawer } from '../../features/runbooks/components/LogDrawer';
import { StatusChip } from '../../features/runbooks/components/StatusChip';
import { AuditPanel } from '../../features/runbooks/components/AuditPanel';

type SortKey = 'position' | 'status' | 'duration';

const STATUS_ORDER: Record<string, number> = {
  failed: 0,
  running: 1,
  waiting: 2,
  queued: 3,
  pending: 4,
  cancelled: 5,
  skipped: 6,
  succeeded: 7,
};

const targetDuration = (t: RunTargetRow): number =>
  t.steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0);

/** Filter and sort the matrix rows. */
export function arrangeTargets(
  targets: readonly RunTargetRow[],
  status: TargetStatus | 'all',
  sort: SortKey
): RunTargetRow[] {
  const rows = status === 'all' ? [...targets] : targets.filter((t) => t.status === status);
  if (sort === 'status')
    rows.sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.position - b.position
    );
  else if (sort === 'duration')
    rows.sort((a, b) => targetDuration(b) - targetDuration(a) || a.position - b.position);
  else rows.sort((a, b) => a.position - b.position);
  return rows;
}

function ProgressHeader({ run }: { run: RunDetail }) {
  const total = Math.max(run.counts.total, 1);
  const parts = (
    ['succeeded', 'failed', 'running', 'waiting', 'cancelled', 'skipped'] as TargetStatus[]
  ).filter((s) => (run.counts[s] ?? 0) > 0);
  const settled =
    (run.counts.succeeded ?? 0) +
    (run.counts.failed ?? 0) +
    (run.counts.cancelled ?? 0) +
    (run.counts.skipped ?? 0);
  return (
    <Box>
      <LinearProgress
        variant="determinate"
        value={(settled / total) * 100}
        aria-label={`${settled} of ${run.counts.total} servers done`}
        sx={{ height: 8, borderRadius: 4, mb: 1 }}
      />
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }} data-testid="run-counts">
        <Chip size="small" label={`${run.counts.total} servers`} />
        {parts.map((status) => {
          const meta = statusMeta(status);
          const { Icon } = meta;
          return (
            <Chip
              key={status}
              size="small"
              variant="outlined"
              icon={<Icon aria-hidden="true" sx={{ '&&': { color: toneColor(meta.tone) } }} />}
              label={`${run.counts[status]} ${meta.label.toLowerCase()}`}
            />
          );
        })}
      </Box>
    </Box>
  );
}

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const canRun = hasPermission('runbooks:run');
  const canApprove = hasPermission('runbooks:approve');
  const live = useRunLive(id);
  const run = live.run;

  const [statusFilter, setStatusFilter] = useState<TargetStatus | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('position');
  const [drawer, setDrawer] = useState<{ targetId: string; stepIndex: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<'servers' | 'audit'>('servers');

  const finished = run ? isRunFinished(run.status) : false;
  useEffect(() => {
    if (finished) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [finished]);

  const rows = useMemo(
    () => (run ? arrangeTargets(run.targets, statusFilter, sort) : []),
    [run, statusFilter, sort]
  );
  const drawerTarget =
    run && drawer ? (run.targets.find((t) => t.id === drawer.targetId) ?? null) : null;

  const act = async (fn: () => Promise<unknown>, after?: (result: unknown) => void) => {
    setBusy(true);
    setActionError(null);
    try {
      const result = await fn();
      after?.(result);
      await live.reload();
    } catch (err) {
      setActionError(errorMessage(err, 'The action failed'));
    } finally {
      setBusy(false);
    }
  };

  if (live.loading && !run) return <LinearProgress aria-label="Loading the run" />;
  if (!run) {
    return (
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Alert severity="error">{live.error ?? 'Run not found'}</Alert>
      </Box>
    );
  }

  const awaitingApproval = (run.approvals ?? []).some(
    (a) => a.kind === 'destructive_run' && a.status === 'pending'
  );
  const failedCount = (run.counts.failed ?? 0) + (run.counts.cancelled ?? 0);
  const initiator =
    run.initiatedBy && run.initiatedBy === user?.id
      ? 'you'
      : run.initiatedBy
        ? 'another user'
        : 'a deleted user';
  const elapsed = formatDuration(elapsedMs(run.startedAt ?? run.createdAt, run.finishedAt, now));

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1600, mx: 'auto', minWidth: 0 }}>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/runs" underline="hover">
          Runs
        </Link>
        <Typography color="text.primary">Run</Typography>
      </Breadcrumbs>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', mb: 2 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="h5" component="h1" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              <Link
                component={RouterLink}
                to={`/runbooks/${run.runbookId}`}
                underline="hover"
                color="inherit"
              >
                {run.runbookName}
              </Link>{' '}
              <Typography component="span" variant="h6" sx={{ color: 'text.secondary' }}>
                v{run.version}
              </Typography>
            </Typography>
            <StatusChip status={run.status} size="medium" />
            {run.dryRun && <Chip color="info" label="DRY RUN" data-testid="dry-run-badge" />}
            {run.destructive && <Chip color="error" variant="outlined" label="Destructive" />}
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {run.trigger === 'manual' ? 'Started' : `Triggered (${run.trigger})`} by {initiator} ·
            elapsed {elapsed || '0 s'}
            {live.streamState === 'polling' ? ' · live updates paused, refreshing every 5 s' : ''}
            {live.streamState === 'reconnecting' ? ' · reconnecting…' : ''}
          </Typography>
          {Object.keys(run.secretRefs).length > 0 && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              Secrets:{' '}
              {Object.entries(run.secretRefs)
                .map(([param, name]) => `${param} → ${name}`)
                .join(', ')}
            </Typography>
          )}
        </Box>
        <Stack
          direction="row"
          spacing={1}
          sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'flex-start' }}
        >
          {canRun && !finished && (
            <Button
              color="error"
              variant="outlined"
              startIcon={<StopCircleOutlinedIcon />}
              disabled={busy || run.status === 'cancelling'}
              onClick={() => void act(() => cancelRun(run.id))}
            >
              Cancel
            </Button>
          )}
          {canRun && canApprove && run.status === 'paused' && (
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              disabled={busy}
              onClick={() => void act(() => resumeRun(run.id))}
            >
              Resume
            </Button>
          )}
          {canRun && finished && failedCount > 0 && (
            <Button
              variant="outlined"
              startIcon={<ReplayIcon />}
              disabled={busy}
              onClick={() =>
                void act(
                  () => retryRun(run.id, 'failed'),
                  (result) => navigate(`/runs/${(result as { runId: string }).runId}`)
                )
              }
            >
              Retry failed
            </Button>
          )}
          {/* TODO(#64): "Stop AI" while an ai_task step runs. TODO(#63): the artifacts panel
              (download and share). */}
        </Stack>
      </Stack>

      {awaitingApproval && (
        <Alert severity="info" sx={{ mb: 2 }} data-testid="awaiting-approval">
          Waiting for a second approver: this destructive run starts only after someone else with
          the approve permission approves it.{' '}
          <Link component={RouterLink} to="/runbooks/approvals">
            Open approvals
          </Link>
        </Alert>
      )}
      {run.errorCode && (
        <Alert
          severity={
            run.errorCode === 'APPROVAL_REJECTED' || run.errorCode === 'APPROVAL_EXPIRED'
              ? 'warning'
              : 'error'
          }
          sx={{ mb: 2 }}
        >
          {run.errorCode === 'APPROVAL_REJECTED'
            ? 'The approval was rejected; nothing ran.'
            : run.errorCode === 'APPROVAL_EXPIRED'
              ? 'The approval expired; nothing ran.'
              : run.errorCode}
        </Alert>
      )}
      {run.dryRun && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Dry run: nothing was changed. Succeeded means the step would run, failed means a
          precondition failed, skipped means it is not simulated.
        </Alert>
      )}
      <ProgressHeader run={run} />

      {(actionError || live.error) && (
        <Alert severity="error" sx={{ mt: 2 }} onClose={() => setActionError(null)}>
          {actionError ?? live.error}
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={(_e, next) => setTab(next)}
        sx={{ mt: 2, borderBottom: 1, borderColor: 'divider' }}
        aria-label="Run views"
      >
        <Tab
          value="servers"
          label="Servers"
          id="run-tab-servers"
          aria-controls="run-panel-servers"
        />
        <Tab value="audit" label="Audit" id="run-tab-audit" aria-controls="run-panel-audit" />
      </Tabs>
      {tab === 'audit' ? (
        <Box role="tabpanel" id="run-panel-audit" aria-labelledby="run-tab-audit" sx={{ mt: 2 }}>
          <AuditPanel runId={run.id} />
        </Box>
      ) : (
        <Box role="tabpanel" id="run-panel-servers" aria-labelledby="run-tab-servers">
          <Stack direction="row" spacing={2} sx={{ my: 2, flexWrap: 'wrap', rowGap: 2 }}>
            <TextField
              select
              size="small"
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as TargetStatus | 'all')}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="all">All servers</MenuItem>
              {TARGET_STATUSES.map((s) => (
                <MenuItem key={s} value={s}>
                  {statusMeta(s).label} ({run.counts[s] ?? 0})
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="position">Run order</MenuItem>
              <MenuItem value="status">Status</MenuItem>
              <MenuItem value="duration">Duration</MenuItem>
            </TextField>
          </Stack>

          {rows.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary', py: 3 }}>
              {run.targets.length === 0
                ? 'No servers resolved yet.'
                : 'No servers with this status.'}
            </Typography>
          ) : phone ? (
            <RunCardList
              targets={rows}
              onOpen={(t, stepIndex) => setDrawer({ targetId: t.id, stepIndex })}
            />
          ) : (
            <RunMatrix
              targets={rows}
              onCellClick={(t, stepIndex) => setDrawer({ targetId: t.id, stepIndex })}
            />
          )}
        </Box>
      )}

      <LogDrawer
        open={Boolean(drawer && drawerTarget)}
        onClose={() => setDrawer(null)}
        runId={run.id}
        target={drawerTarget}
        stepIndex={drawer?.stepIndex ?? 0}
        onStepChange={(stepIndex) => setDrawer((d) => (d ? { ...d, stepIndex } : d))}
        onChunk={live.onChunk}
        fullScreen={phone}
      />
    </Box>
  );
}
