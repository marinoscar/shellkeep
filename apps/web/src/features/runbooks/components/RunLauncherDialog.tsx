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
 * #67 (dry run, destructive confirmation, two-person rule) slots in at the `TODO(#67)` marks:
 * nothing is sent for them until the API accepts the fields, because the run body is not strict
 * and an ignored `dryRun` would run for real.
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
  DefinitionIssue,
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
  const [submitting, setSubmitting] = useState(false);

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
      setParams(initialParamValues(view.definition.parameters));
      setSecretRefs({});
    } catch (err) {
      setLoadError(errorMessage(err, 'Could not load that version'));
    }
  };

  const concurrency = strategy.concurrency ?? definition?.strategy.concurrency ?? 1;
  const serverCount = preview?.servers.length ?? 0;
  const summary = useMemo(() => launchSummary(serverCount, concurrency), [serverCount, concurrency]);

  const submit = async () => {
    if (!runbookId || !definition) return;
    const clientErrors = validateParams(definition.parameters, params, secretRefs);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const overrides = Object.fromEntries(Object.entries(strategy).filter(([, v]) => v !== undefined)) as Partial<RunStrategy>;
      const { runId } = await startRun(runbookId, {
        ...(version ? { version } : {}),
        params: toRunParams(definition.parameters, params),
        ...(Object.keys(secretRefs).length > 0 ? { secretRefs } : {}),
        targets,
        ...(Object.keys(overrides).length > 0 ? { strategy: overrides } : {}),
        // TODO(#67): `dryRun` and the destructive confirmation go here once the API accepts them.
      });
      onClose();
      navigate(`/runs/${runId}`);
    } catch (err) {
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
      setSubmitting(false);
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

              {/* TODO(#67): the dry-run switch and the destructive confirmation (type the runbook name)
                  render here once the safety API is on main. */}
            </>
          )}
          {submitError && <Alert severity="error">{submitError}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, px: 3 }}>
        <Typography variant="body2" data-testid="launch-summary" sx={{ color: 'text.secondary' }}>
          {ready ? summary : ''}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => void submit()}
            disabled={!ready || submitting || isEmptyTargets(targets) || serverCount === 0}
          >
            {submitting ? 'Starting…' : 'Run'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
