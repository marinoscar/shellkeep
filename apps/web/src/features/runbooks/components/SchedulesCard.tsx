/**
 * The schedules of a runbook (issue #66), a section of the runbook detail page: each schedule with when it runs
 * next, how its last run ended and an enabled switch; a banner when the system switched it off (permission
 * revoked, approval needed); and the actions Run now, Change, Approve (`runbooks:approve`) and Delete.
 * Reading needs `runbooks:read`; creating and changing need `runbooks:write` and `runbooks:run`.
 */
import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, IconButton, List, ListItem, Stack, Switch, Tooltip, Typography } from '@mui/material';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Link as RouterLink } from 'react-router-dom';
import { relativeTime } from '../../../components/home/relativeTime';
import { approveSchedule, deleteSchedule, listSchedules, runScheduleNow, updateSchedule } from '../api/runbooksApi';
import type { RunbookDefinition, RunbookSchedule } from '../api/types';
import { errorMessage, useAsync } from '../hooks/useAsync';
import { DISABLED_REASON_COPY } from '../lib/cron';
import { ScheduleEditorDialog } from './ScheduleEditorDialog';
import { StatusChip } from './StatusChip';

export interface SchedulesCardProps {
  runbookId: string;
  runbookName: string;
  definition: RunbookDefinition | undefined;
  /** `runbooks:write` and `runbooks:run`, and the runbook is not archived. */
  canWrite: boolean;
  canRun: boolean;
  canApprove: boolean;
}

export function SchedulesCard({ runbookId, runbookName, definition, canWrite, canRun, canApprove }: SchedulesCardProps) {
  const schedules = useAsync(() => listSchedules(runbookId), [runbookId]);
  const [editing, setEditing] = useState<RunbookSchedule | null | 'new'>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setActionError(null);
    try {
      await fn();
      await schedules.reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const items = schedules.data?.items ?? [];
  return (
    <Card variant="outlined" component="section" aria-labelledby="rb-schedules">
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography id="rb-schedules" variant="h6" component="h2">
            Schedules
          </Typography>
          {canWrite && definition && (
            <Button size="small" onClick={() => setEditing('new')}>
              Add
            </Button>
          )}
        </Stack>
        {actionError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {actionError}
          </Alert>
        )}
        {schedules.error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {schedules.error}
          </Alert>
        )}
        {!schedules.loading && items.length === 0 && !schedules.error && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Not scheduled.
          </Typography>
        )}
        <List dense disablePadding>
          {items.map((s) => {
            const needsApproval = s.destructive && s.approval.state !== 'approved';
            const reason = s.disabledReason ? (DISABLED_REASON_COPY[s.disabledReason] ?? `Turned off: ${s.disabledReason}`) : null;
            return (
              <ListItem key={s.id} disableGutters sx={{ display: 'block', py: 1 }} data-testid={`schedule-${s.id}`}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                  <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere', flex: 1, minWidth: 120 }}>
                    {s.name}
                  </Typography>
                  {s.destructive && <Chip size="small" color="error" variant="outlined" label="Destructive" />}
                  <Switch
                    size="small"
                    checked={s.enabled}
                    disabled={!canWrite || busy === s.id || (needsApproval && !s.enabled)}
                    onChange={(_e, checked) => void act(s.id, () => updateSchedule(runbookId, s.id, { enabled: checked }))}
                    slotProps={{ input: { 'aria-label': `${s.enabled ? 'Turn off' : 'Turn on'} ${s.name}` } }}
                  />
                </Stack>
                <Typography variant="caption" component="p" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                  {s.cron} · {s.timezone}
                </Typography>
                <Typography variant="body2" component="p">
                  {s.enabled && s.nextRunAt ? `Next run ${new Date(s.nextRunAt).toLocaleString(undefined, { timeZone: s.timezone, dateStyle: 'medium', timeStyle: 'short' })}` : 'Not scheduled to run'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  {s.lastRunId && s.lastRunStatus ? (
                    <>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        Last run {s.lastFiredAt ? relativeTime(s.lastFiredAt) : ''}
                      </Typography>
                      <StatusChip status={s.lastRunStatus} />
                      <Button size="small" component={RouterLink} to={`/runs/${s.lastRunId}`}>
                        View
                      </Button>
                    </>
                  ) : (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      Never run
                    </Typography>
                  )}
                </Box>
                {reason && (
                  <Alert severity="warning" sx={{ mt: 0.5 }}>
                    {reason}
                  </Alert>
                )}
                {!reason && needsApproval && (
                  <Alert severity="info" sx={{ mt: 0.5 }}>
                    This destructive schedule has not been approved for version {s.resolvedVersion ?? '?'}.
                  </Alert>
                )}
                <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                  {needsApproval && canApprove && (
                    <Button size="small" variant="outlined" disabled={busy === s.id} onClick={() => void act(s.id, () => approveSchedule(runbookId, s.id))}>
                      Approve
                    </Button>
                  )}
                  {canRun && (
                    <Tooltip title="Run it now, as you">
                      <span>
                        <IconButton size="small" aria-label={`Run ${s.name} now`} disabled={busy === s.id || needsApproval} onClick={() => void act(s.id, () => runScheduleNow(runbookId, s.id))}>
                          <PlayArrowIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                  {canWrite && (
                    <>
                      <IconButton size="small" aria-label={`Change ${s.name}`} onClick={() => setEditing(s)}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" aria-label={`Delete ${s.name}`} disabled={busy === s.id} onClick={() => void act(s.id, () => deleteSchedule(runbookId, s.id))}>
                        <DeleteOutlinedIcon fontSize="small" />
                      </IconButton>
                    </>
                  )}
                </Stack>
              </ListItem>
            );
          })}
        </List>
      </CardContent>
      {definition && editing !== null && (
        <ScheduleEditorDialog
          open
          runbookId={runbookId}
          runbookName={runbookName}
          definition={definition}
          schedule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => void schedules.reload()}
        />
      )}
    </Card>
  );
}
