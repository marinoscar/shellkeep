/**
 * The run launcher (issue #65): pick a version, fill the parameters (generated from the
 * definition), pick the secrets by name, choose the targets (the definition's defaults, or the
 * servers a deep link pre-selected) and optionally override the strategy. "Run" posts
 * `POST /api/runbooks/:id/runs` and navigates to `/runs/:runId`.
 *
 * Deep link (#79, the Servers page's "Run runbook on selected"):
 *   `/runbooks/:id/run?targets=<serverId>,<serverId>`  this runbook, these servers;
 *   `/runbooks/run?targets=<serverId>,<serverId>`      the person picks the runbook first.
 * Both open this dialog over the page (`pages/runbooks/RunLauncherPage.tsx`).
 *
 * #67: "Dry run" posts `dryRun: true` (probes only, no confirmation). A destructive runbook
 * (its `risk`, or a `428 RUNBOOK_CONFIRMATION_REQUIRED`) needs the person to type its exact name
 * and the number of servers it resolves to; the run is resent with `confirm`. When the two-person
 * rule applies the button reads "Request approval" and the run waits for someone else.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../../services/api';
import {
  getRunbook,
  getVersion,
  listRunbooks,
  listRunbookSecrets,
  listVersions,
  startRun,
} from '../api/runbooksApi';
import type {
  ConfirmationRequired,
  DefinitionIssue,
  RunbookRisk,
  RunbookDefinition,
  RunbookListItem,
  RunbookSecret,
  RunbookVersionSummary,
  RunStrategy,
  TargetPreview,
} from '../api/types';
import { errorMessage } from '../hooks/useAsync';
import { ParamsForm, initialParamValues, toRunParams, validateParams, type ParamValues } from './ParamsForm';
import { StrategyFields } from './StrategyFields';
import { TargetPicker, isEmptyTargets, toTargetValue, type TargetValue } from './TargetPicker';
import { RiskChip } from './RiskChip';

export interface RunLauncherDialogProps {
  open: boolean;
  onClose: () => void;
  /** Absent: the dialog asks for the runbook first. */
  runbookId?: string;
  /** Server ids to pre-select instead of the definition's default targets. */
  initialServerIds?: readonly string[];
}

/** "N servers · up to C in parallel" (the summary line). */
export function launchSummary(serverCount: number, concurrency: number): string {
  const parallel = Math.max(1, Math.min(concurrency, serverCount));
  const servers = `${serverCount} ${serverCount === 1 ? 'server' : 'servers'}`;
  return serverCount === 0 ? 'No servers' : `${servers} · up to ${parallel} in parallel`;
}

/** The param name an API issue is about (`['params', 'NAME']` or `['NAME']`). */
function issueParam(issue: DefinitionIssue): string | undefined {
  const last = [...issue.path].reverse().find((segment) => typeof segment === 'string' && /^[A-Z][A-Z0-9_]*$/.test(segment));
  return typeof last === 'string' ? last : undefined;
}

export function RunLauncherDialog({ open, onClose, runbookId: fixedRunbookId, initialServerIds }: RunLauncherDialogProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();

  const [runbookId, setRunbookId] = useState<string | undefined>(fixedRunbookId);
  const [runbookOptions, setRunbookOptions] = useState<RunbookListItem[]>([]);
  const [runbookName, setRunbookName] = useState('');
  const [versions, setVersions] = useState<RunbookVersionSummary[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [definition, setDefinition] = useState<RunbookDefinition | null>(null);
  const [secrets, setSecrets] = useState<RunbookSecret[]>([]);
  const [params, setParams] = useState<ParamValues>({});
  const [secretRefs, setSecretRefs] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<TargetValue>(toTargetValue());
  const [strategy, setStrategy] = useState<Partial<RunStrategy>>({});
  const [preview, setPreview] = useState<TargetPreview | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState<'run' | 'dry' | null>(null);
  const [risk, setRisk] = useState<RunbookRisk | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationRequired | null>(null);
  const [typedName, setTypedName] = useState('');
  const [typedCount, setTypedCount] = useState('');

  useEffect(() => {
    setRunbookId(fixedRunbookId);
  }, [fixedRunbookId]);

  // No runbook given: offer the ones the person can run.
  useEffect(() => {
    if (!open || fixedRunbookId) return;
    listRunbooks({ pageSize: 100 })
      .then((page) => setRunbookOptions(page.items.filter((r) => r.access.can.run)))
      .catch((err) => setLoadError(errorMessage(err, 'Could not load the runbooks')));
  }, [open, fixedRunbookId]);

  // The runbook: its latest definition, versions and the secrets.
  useEffect(() => {
    if (!open || !runbookId) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([getRunbook(runbookId), listVersions(runbookId), listRunbookSecrets().catch(() => [] as RunbookSecret[])])
      .then(([detail, history, secretList]) => {
        if (cancelled) return;
        const latest = detail.latestVersion;
        setRunbookName(detail.name);
        setRisk(detail.risk ?? latest?.risk ?? null);
        setConfirmation(null);
        setTypedName('');
        setTypedCount('');
        setVersions(history.items);
        setVersion(latest?.version ?? null);
        setDefinition(latest?.definition ?? null);
        setSecrets(secretList);
        setParams(initialParamValues(latest?.definition.parameters ?? []));
        setSecretRefs({});
        setStrategy({});
        setTargets(
          initialServerIds && initialServerIds.length > 0
            ? toTargetValue({ serverIds: [...initialServerIds] })
            : toTargetValue(latest?.definition.defaultTargets),
        );
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err, 'Could not load the runbook'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runbookId]);

  const chooseVersion = async (next: number) => {
    if (!runbookId) return;
    setVersion(next);
    try {
      const view = await getVersion(runbookId, next);
      setDefinition(view.definition);
      if (view.risk) setRisk(view.risk);
      setParams(initialParamValues(view.definition.parameters));
      setSecretRefs({});
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load that version'));
    }
  };

  const concurrency = strategy.concurrency ?? definition?.strategy.concurrency ?? 1;
  const serverCount = preview?.servers.length ?? 0;
  const summary = useMemo(() => launchSummary(serverCount, concurrency), [serverCount, concurrency]);

  const destructive = Boolean(risk?.destructive || confirmation);
  /** The count the person must type: what the API resolved, else the live preview. */
  const expectedCount = confirmation?.targetCount ?? serverCount;
  const confirmed = !destructive || (typedName === (confirmation?.runbookName ?? runbookName) && typedCount.trim() !== '' && Number(typedCount) === expectedCount);

  const submit = async (mode: 'run' | 'dry') => {
    if (!runbookId || !definition) return;
    const clientErrors = validateParams(definition.parameters, params, secretRefs);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) return;
    setSubmitting(mode);
    setSubmitError(null);
    try {
      const overrides = Object.fromEntries(Object.entries(strategy).filter(([, v]) => v !== undefined)) as Partial<RunStrategy>;
      const result = await startRun(runbookId, {
        ...(version ? { version } : {}),
        params: toRunParams(definition.parameters, params),
        ...(Object.keys(secretRefs).length > 0 ? { secretRefs } : {}),
        targets,
        ...(Object.keys(overrides).length > 0 ? { strategy: overrides } : {}),
        ...(mode === 'dry' ? { dryRun: true } : {}),
        ...(mode === 'run' && destructive ? { confirm: { runbookName: typedName, targetCount: Number(typedCount) } } : {}),
      });
      onClose();
      navigate(`/runs/${result.runId}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 428 && err.details) {
        // A destructive runbook: show the confirmation, then the person resends.
        setConfirmation(err.details as ConfirmationRequired);
        setTypedCount('');
        return;
      }
      if (err instanceof ApiError && Array.isArray((err.details as { issues?: unknown })?.issues)) {
        const issues = (err.details as { issues: DefinitionIssue[] }).issues;
        const mapped: Record<string, string> = {};
        for (const issue of issues) {
          const name = issueParam(issue);
          if (name) mapped[name] = issue.message;
        }
        setErrors(mapped);
      }
      setSubmitError(errorMessage(err, 'The run could not start'));
    } finally {
      setSubmitting(null);
    }
  };

  const ready = Boolean(runbookId && definition && !loading);

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="md" aria-labelledby="run-launcher-title">
      <DialogTitle id="run-launcher-title">{runbookName ? `Run "${runbookName}"` : 'Run a runbook'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          {loadError && <Alert severity="error">{loadError}</Alert>}
          {!fixedRunbookId && (
            <Autocomplete
              options={runbookOptions}
              getOptionLabel={(r) => r.name}
              value={runbookOptions.find((r) => r.id === runbookId) ?? null}
              onChange={(_e, r) => setRunbookId(r?.id)}
              renderInput={(params) => <TextField {...params} label="Runbook" size="small" />}
            />
          )}
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress aria-label="Loading the runbook" />
            </Box>
          )}
          {ready && definition && (
            <>
              <TextField
                select
                size="small"
                label="Version"
                value={version ?? ''}
                onChange={(e) => void chooseVersion(Number(e.target.value))}
                sx={{ maxWidth: 320 }}
              >
                {versions.map((v, index) => (
                  <MenuItem key={v.version} value={v.version}>
                    v{v.version}
                    {index === 0 ? ' (latest)' : ''}
                    {v.changelog ? ` · ${v.changelog}` : ''}
                  </MenuItem>
                ))}
              </TextField>

              {definition.parameters.length > 0 && (
                <Box component="section" aria-labelledby="launcher-params">
                  <Typography id="launcher-params" variant="subtitle2" component="h3" sx={{ mb: 1.5 }}>
                    Parameters
                  </Typography>
                  <ParamsForm
                    parameters={definition.parameters}
                    values={params}
                    secretRefs={secretRefs}
                    secrets={secrets}
                    errors={errors}
                    onChange={setParams}
                    onSecretRefsChange={setSecretRefs}
                  />
                </Box>
              )}

              <Box component="section" aria-labelledby="launcher-targets">
                <Typography id="launcher-targets" variant="subtitle2" component="h3" sx={{ mb: 1.5 }}>
                  Targets
                </Typography>
                <TargetPicker value={targets} onChange={setTargets} onPreview={setPreview} height={280} />
              </Box>

              <Accordion disableGutters variant="outlined">
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle2" component="h3">
                    Strategy overrides
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <StrategyFields value={{ ...definition.strategy, ...strategy }} onChange={(next) => setStrategy(next)} />
                </AccordionDetails>
              </Accordion>

              {destructive && (
                <Box
                  component="section"
                  aria-labelledby="launcher-confirm"
                  data-testid="destructive-confirm"
                  sx={{ border: 1, borderColor: 'error.main', borderRadius: 1, p: 2 }}
                >
                  <Typography id="launcher-confirm" variant="subtitle2" component="h3" sx={{ color: 'error.main', mb: 1 }}>
                    This runbook is destructive
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                    {(confirmation?.findings ?? risk?.findings ?? [])
                      .filter((f) => f.destructive || f.risk !== 'low')
                      .map((f) => (
                        <Box key={`${f.stepId}-${f.stepIndex}`} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography variant="caption">Step {f.stepIndex + 1}</Typography>
                          <RiskChip finding={f} />
                        </Box>
                      ))}
                  </Box>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    It will run on
                  </Typography>
                  <Typography variant="h3" component="p" data-testid="confirm-count" sx={{ fontWeight: 700, lineHeight: 1, mb: 1 }}>
                    {expectedCount} {expectedCount === 1 ? 'server' : 'servers'}
                  </Typography>
                  {confirmation?.requiresApproval && (
                    <Alert severity="info" sx={{ mb: 2 }}>
                      Someone else with the approve permission must approve this run before it starts.
                    </Alert>
                  )}
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                      size="small"
                      label="Type the runbook name to confirm"
                      value={typedName}
                      onChange={(e) => setTypedName(e.target.value)}
                      helperText={confirmation?.runbookName ?? runbookName}
                      autoComplete="off"
                      fullWidth
                    />
                    <TextField
                      size="small"
                      label="Type the number to confirm"
                      value={typedCount}
                      onChange={(e) => setTypedCount(e.target.value.replace(/\D/g, ''))}
                      slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                      autoComplete="off"
                      sx={{ minWidth: { sm: 200 } }}
                    />
                  </Stack>
                </Box>
              )}
            </>
          )}
          {submitError && <Alert severity="error">{submitError}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, px: 3 }}>
        <Typography variant="body2" data-testid="launch-summary" sx={{ color: 'text.secondary' }}>
          {ready ? summary : ''}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end', ml: 'auto' }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="outlined"
            onClick={() => void submit('dry')}
            disabled={!ready || submitting !== null || isEmptyTargets(targets) || serverCount === 0}
          >
            {submitting === 'dry' ? 'Starting…' : 'Dry run'}
          </Button>
          <Button
            variant="contained"
            color={destructive ? 'error' : 'primary'}
            onClick={() => void submit('run')}
            disabled={!ready || submitting !== null || isEmptyTargets(targets) || serverCount === 0 || !confirmed}
          >
            {submitting === 'run' ? 'Starting…' : confirmation?.requiresApproval ? 'Request approval' : 'Run'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
