/**
 * Create or change one schedule (issue #66): a name, when (presets for hourly, daily and weekly, or a custom
 * 5-field expression), the time zone, a live "next 5 runs" preview from the API, the overlap policy, the
 * parameters (`ParamsForm`), the servers (`TargetPicker`) and, for a destructive runbook, the typed
 * confirmation of the runbook name and server count (the API answers 428 with both; the same flow as the
 * launcher). A destructive schedule is saved switched off until a second person approves it.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ApiError } from '../../../services/api';
import { createSchedule, listRunbookSecrets, previewSchedule, updateSchedule } from '../api/runbooksApi';
import type { ConfirmationRequired, RunbookDefinition, RunbookSchedule, RunbookSecret, ScheduleOverlap } from '../api/types';
import { errorMessage } from '../hooks/useAsync';
import {
  DEFAULT_CRON_PARTS,
  WEEKDAYS,
  browserTimezone,
  buildCron,
  parseCron,
  timezoneOptions,
  type CronParts,
  type CronPreset,
} from '../lib/cron';
import { ParamsForm, initialParamValues, toRunParams, validateParams, type ParamValues } from './ParamsForm';
import { TargetPicker, isEmptyTargets, toTargetValue, type TargetValue } from './TargetPicker';

export interface ScheduleEditorDialogProps {
  open: boolean;
  runbookId: string;
  runbookName: string;
  definition: RunbookDefinition;
  /** The schedule being changed; absent to create one. */
  schedule?: RunbookSchedule | null;
  onClose: () => void;
  onSaved: (schedule: RunbookSchedule) => void;
}

const OVERLAP_COPY: Record<ScheduleOverlap, string> = {
  skip: 'Skip it while the previous run is still active',
  queue: 'Start it anyway',
  allow: 'Always start it',
};

export function ScheduleEditorDialog({ open, runbookId, runbookName, definition, schedule, onClose, onSaved }: ScheduleEditorDialogProps) {
  const editing = Boolean(schedule);
  const [name, setName] = useState('');
  const [cron, setCron] = useState<CronParts>(DEFAULT_CRON_PARTS);
  const [timezone, setTimezone] = useState(browserTimezone());
  const [overlap, setOverlap] = useState<ScheduleOverlap>('skip');
  const [params, setParams] = useState<ParamValues>({});
  const [secretRefs, setSecretRefs] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<RunbookSecret[]>([]);
  const [targets, setTargets] = useState<TargetValue>(toTargetValue());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [next, setNext] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationRequired | null>(null);
  const [typedName, setTypedName] = useState('');
  const [typedCount, setTypedCount] = useState('');

  const expression = buildCron(cron);
  const zones = useMemo(() => timezoneOptions(), []);

  useEffect(() => {
    if (!open) return;
    setName(schedule?.name ?? '');
    setCron(schedule ? parseCron(schedule.cron) : DEFAULT_CRON_PARTS);
    setTimezone(schedule?.timezone ?? browserTimezone());
    setOverlap(schedule?.overlap ?? 'skip');
    setParams({ ...initialParamValues(definition.parameters), ...(schedule?.params ?? {}) });
    setSecretRefs({ ...(schedule?.secretRefs ?? {}) });
    setTargets(toTargetValue(schedule?.targets ?? definition.defaultTargets));
    setErrors({});
    setSubmitError(null);
    setConfirmation(null);
    setTypedName('');
    setTypedCount('');
    listRunbookSecrets().then(setSecrets, () => setSecrets([]));
  }, [open, schedule, definition]);

  // The next five runs, from the API (the one place that knows what a valid expression is).
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      previewSchedule(expression, timezone).then(
        (result) => {
          if (cancelled) return;
          setNext(result.next);
          setPreviewError(null);
        },
        (err) => {
          if (cancelled) return;
          setNext([]);
          setPreviewError(errorMessage(err, 'That schedule is not valid'));
        },
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, expression, timezone]);

  const destructive = Boolean(confirmation);
  const confirmed =
    !destructive || (typedName === confirmation!.runbookName && typedCount.trim() !== '' && Number(typedCount) === confirmation!.targetCount);

  const save = async () => {
    const found = validateParams(definition.parameters, params, secretRefs);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    setSaving(true);
    setSubmitError(null);
    const body = {
      name: name.trim(),
      cron: expression,
      timezone,
      overlap,
      params: toRunParams(definition.parameters, params),
      secretRefs,
      targets,
      ...(destructive ? { confirm: { runbookName: typedName, targetCount: Number(typedCount) } } : {}),
    };
    try {
      const saved = schedule ? await updateSchedule(runbookId, schedule.id, body) : await createSchedule(runbookId, body);
      onSaved(saved);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 428 && err.details) {
        setConfirmation(err.details as ConfirmationRequired);
        setTypedCount('');
        return;
      }
      setSubmitError(errorMessage(err, 'The schedule could not be saved'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="schedule-editor-title">
      <DialogTitle id="schedule-editor-title">{editing ? 'Change schedule' : `Schedule "${runbookName}"`}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          {submitError && <Alert severity="error">{submitError}</Alert>}
          <TextField label="Name" size="small" value={name} onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { maxLength: 120 } }} required />

          <Stack spacing={2} component="section" aria-label="When">
            <Typography variant="subtitle2" component="h3">
              When
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select size="small" label="Repeat" value={cron.preset} onChange={(e) => setCron({ ...cron, preset: e.target.value as CronPreset })} sx={{ minWidth: 160 }}>
                <MenuItem value="hourly">Hourly</MenuItem>
                <MenuItem value="daily">Daily</MenuItem>
                <MenuItem value="weekly">Weekly</MenuItem>
                <MenuItem value="custom">Custom</MenuItem>
              </TextField>
              {cron.preset === 'weekly' && (
                <TextField select size="small" label="On" value={cron.weekday} onChange={(e) => setCron({ ...cron, weekday: Number(e.target.value) })} sx={{ minWidth: 150 }}>
                  {WEEKDAYS.map((day, index) => (
                    <MenuItem key={day} value={index}>
                      {day}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {(cron.preset === 'daily' || cron.preset === 'weekly') && (
                <TextField
                  size="small"
                  label="At hour"
                  type="number"
                  value={cron.hour}
                  onChange={(e) => setCron({ ...cron, hour: Math.min(23, Math.max(0, Math.trunc(Number(e.target.value)) || 0)) })}
                  slotProps={{ htmlInput: { min: 0, max: 23 } }}
                  sx={{ width: 110 }}
                />
              )}
              {cron.preset !== 'custom' && (
                <TextField
                  size="small"
                  label="Minute"
                  type="number"
                  value={cron.minute}
                  onChange={(e) => setCron({ ...cron, minute: Math.min(59, Math.max(0, Math.trunc(Number(e.target.value)) || 0)) })}
                  slotProps={{ htmlInput: { min: 0, max: 59 } }}
                  sx={{ width: 110 }}
                />
              )}
              {cron.preset === 'custom' && (
                <TextField
                  size="small"
                  label="Cron expression"
                  value={cron.custom}
                  onChange={(e) => setCron({ ...cron, custom: e.target.value })}
                  helperText="Five fields: minute hour day-of-month month day-of-week"
                  sx={{ minWidth: 240, fontFamily: 'monospace' }}
                />
              )}
            </Stack>
            <Autocomplete
              options={zones}
              value={timezone}
              onChange={(_e, zone) => zone && setTimezone(zone)}
              disableClearable
              renderInput={(inputParams) => <TextField {...inputParams} label="Time zone" size="small" />}
              sx={{ maxWidth: 360 }}
            />
            {previewError ? (
              <Alert severity="warning">{previewError}</Alert>
            ) : (
              <Box aria-label="Next runs" data-testid="schedule-preview">
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Next runs ({timezone})
                </Typography>
                {next.map((iso) => (
                  <Typography key={iso} variant="body2">
                    {new Date(iso).toLocaleString(undefined, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' })}
                  </Typography>
                ))}
              </Box>
            )}
          </Stack>

          <TextField select size="small" label="If the previous run is still going" value={overlap} onChange={(e) => setOverlap(e.target.value as ScheduleOverlap)} sx={{ maxWidth: 420 }}>
            {(Object.keys(OVERLAP_COPY) as ScheduleOverlap[]).map((policy) => (
              <MenuItem key={policy} value={policy}>
                {OVERLAP_COPY[policy]}
              </MenuItem>
            ))}
          </TextField>

          {definition.parameters.length > 0 && (
            <ParamsForm
              parameters={definition.parameters}
              values={params}
              secretRefs={secretRefs}
              secrets={secrets}
              errors={errors}
              onChange={setParams}
              onSecretRefsChange={setSecretRefs}
            />
          )}

          <Box component="section" aria-label="Servers">
            <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
              Servers
            </Typography>
            <TargetPicker value={targets} onChange={setTargets} height={260} />
          </Box>

          {confirmation && (
            <Alert severity="error" data-testid="schedule-confirm">
              <Typography variant="subtitle2">This runbook has a destructive step</Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Every scheduled run skips the per-run confirmation, so confirm it once here. It will reach {confirmation.targetCount} servers
                {confirmation.requiresApproval ? ' and starts only after a second person approves the schedule.' : '.'}
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField size="small" label="Type the runbook name to confirm" helperText={confirmation.runbookName} value={typedName} onChange={(e) => setTypedName(e.target.value)} />
                <TextField size="small" label="Type the number of servers" value={typedCount} onChange={(e) => setTypedCount(e.target.value)} />
              </Stack>
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => void save()} disabled={saving || name.trim() === '' || Boolean(previewError) || isEmptyTargets(targets) || !confirmed}>
          {saving ? 'Saving…' : editing ? 'Save' : 'Create schedule'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
