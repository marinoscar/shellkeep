/**
 * The runbook builder (issue #65, Subtask B) at `/runbooks/new` and `/runbooks/:id/edit`.
 *
 * Left, the ordered steps; right, the selected step's editor; below, the parameters, default
 * targets and strategy panels. "Validate" calls `POST /api/runbooks/validate` and maps the Zod
 * issue paths onto the fields; "Save" creates the runbook, or appends a version with
 * `PUT .../definition` and `If-Match: "v<n>"`. A 412 opens "Someone saved a newer version" with
 * Reload (drop the local edits) or Overwrite (re-fetch the newest version, then save the local
 * edits on top of it). Leaving with unsaved changes asks first.
 *
 * At phone width the page is one column and the step editor opens as a full-screen dialog
 * (a page-content breakpoint, not one of the shell's five gates).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Autocomplete,
  LinearProgress,
  Link,
  Snackbar,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HistoryIcon from '@mui/icons-material/History';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../services/api';
import {
  createRunbook,
  getRunbook,
  replaceDefinition,
  updateRunbookMetadata,
  validateDefinition,
} from '../../features/runbooks/api/runbooksApi';
import type { DefinitionWarning, RunbookDefinition, RunbookDetail, RunbookStep } from '../../features/runbooks/api/types';
import { errorMessage } from '../../features/runbooks/hooks/useAsync';
import { useUnsavedChangesGuard } from '../../features/runbooks/hooks/useUnsavedChangesGuard';
import { emptyDefinition, issuesToFieldErrors, move, newStep, stepErrorCount } from '../../features/runbooks/lib/builder';
import { StepList } from '../../features/runbooks/components/builder/StepList';
import { StepEditor } from '../../features/runbooks/components/builder/StepEditor';
import { ParametersEditor } from '../../features/runbooks/components/builder/ParametersEditor';
import { StrategyFields } from '../../features/runbooks/components/StrategyFields';
import { TargetPicker, toTargetValue } from '../../features/runbooks/components/TargetPicker';
import { VersionHistoryDrawer } from '../../features/runbooks/components/VersionHistoryDrawer';

interface Meta {
  name: string;
  description: string;
  tags: string[];
}

const EMPTY_META: Meta = { name: '', description: '', tags: [] };

const snapshotOf = (meta: Meta, definition: RunbookDefinition) => JSON.stringify({ meta, definition });

function metaOf(rb: RunbookDetail): Meta {
  return { name: rb.name, description: rb.description ?? '', tags: rb.tags };
}

export default function RunbookBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const isNew = !id;

  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta>(EMPTY_META);
  const [definition, setDefinition] = useState<RunbookDefinition>(() => emptyDefinition());
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [saved, setSaved] = useState(() => snapshotOf(EMPTY_META, emptyDefinition()));
  const [selected, setSelected] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<DefinitionWarning[]>([]);
  const [changelog, setChangelog] = useState('');
  const [busy, setBusy] = useState<'validate' | 'save' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const apply = (rb: RunbookDetail) => {
    const nextMeta = metaOf(rb);
    const nextDefinition = rb.latestVersion?.definition ?? emptyDefinition();
    setMeta(nextMeta);
    setDefinition(nextDefinition);
    setBaseVersion(rb.latestVersion?.version ?? 0);
    setSaved(snapshotOf(nextMeta, nextDefinition));
    setSelected(0);
    setErrors({});
    setWarnings([]);
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getRunbook(id)
      .then(apply)
      .catch((err) => setLoadError(errorMessage(err, 'Could not load the runbook')))
      .finally(() => setLoading(false));
  }, [id]);

  const dirty = snapshotOf(meta, definition) !== saved;
  useUnsavedChangesGuard(dirty);

  const steps = definition.steps;
  const step = steps[Math.min(selected, steps.length - 1)];
  const setSteps = (next: RunbookStep[]) => setDefinition((d) => ({ ...d, steps: next }));
  const warningsFor = (index: number) =>
    warnings.filter((w) => w.path[0] === 'steps' && w.path[1] === index);

  const validate = async (): Promise<boolean> => {
    setBusy('validate');
    setFormError(null);
    try {
      const result = await validateDefinition(definition);
      setErrors({});
      setWarnings(result.warnings);
      setNotice(result.warnings.length ? `Valid, with ${result.warnings.length} warning(s)` : 'The definition is valid');
      return true;
    } catch (err) {
      const fieldErrors = issuesToFieldErrors(err);
      if (fieldErrors) {
        setErrors(fieldErrors);
        setFormError(`The definition has ${Object.keys(fieldErrors).length} problem(s); they are marked on the fields.`);
        const firstStep = Object.keys(fieldErrors).find((k) => k.startsWith('steps.'));
        if (firstStep) setSelected(Number(firstStep.split('.')[1]));
      } else {
        setFormError(errorMessage(err, 'Validation failed'));
      }
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = async (overVersion?: number) => {
    setBusy('save');
    setFormError(null);
    try {
      if (isNew) {
        const created = await createRunbook({
          name: meta.name.trim(),
          ...(meta.description.trim() ? { description: meta.description.trim() } : {}),
          tags: meta.tags,
          definition,
          ...(changelog.trim() ? { changelog: changelog.trim() } : {}),
        });
        setSaved(snapshotOf(meta, definition));
        navigate(`/runbooks/${created.id}`, { replace: true });
        return;
      }
      const savedMeta: Meta = JSON.parse(saved).meta;
      if (JSON.stringify(savedMeta) !== JSON.stringify(meta)) {
        await updateRunbookMetadata(id!, { name: meta.name.trim(), description: meta.description.trim() || null, tags: meta.tags });
      }
      const savedDefinition = JSON.stringify(JSON.parse(saved).definition);
      let version = overVersion ?? baseVersion ?? 0;
      if (savedDefinition !== JSON.stringify(definition) || overVersion !== undefined) {
        const result = await replaceDefinition(id!, version, { definition, ...(changelog.trim() ? { changelog: changelog.trim() } : {}) });
        version = result.latestVersion?.version ?? version;
        setNotice(result.created ? `Saved version ${version}` : 'No change to the definition');
      } else {
        setNotice('Saved');
      }
      setBaseVersion(version);
      setSaved(snapshotOf(meta, definition));
      setChangelog('');
      setErrors({});
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) {
        setConflict(true);
        return;
      }
      const fieldErrors = issuesToFieldErrors(err);
      if (fieldErrors) setErrors(fieldErrors);
      setFormError(errorMessage(err, 'Could not save'));
    } finally {
      setBusy(null);
    }
  };

  /** Reload: take the newest version, dropping the local edits. */
  const reload = async () => {
    setConflict(false);
    if (!id) return;
    try {
      apply(await getRunbook(id));
      setNotice('Reloaded the newest version');
    } catch (err) {
      setFormError(errorMessage(err, 'Could not reload'));
    }
  };

  /** Overwrite: re-fetch the newest version number, then save the local edits on top of it. */
  const overwrite = async () => {
    setConflict(false);
    if (!id) return;
    try {
      const latest = await getRunbook(id);
      await save(latest.latestVersion?.version ?? 0);
    } catch (err) {
      setFormError(errorMessage(err, 'Could not overwrite'));
    }
  };

  const errorCount = useMemo(() => (index: number) => stepErrorCount(errors, index), [errors]);

  if (loading) return <LinearProgress aria-label="Loading the runbook" />;
  if (loadError) {
    return (
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Alert severity="error">{loadError}</Alert>
      </Box>
    );
  }

  const editor = step ? (
    <StepEditor
      step={step}
      index={selected}
      onChange={(next) => setSteps(steps.map((s, i) => (i === selected ? next : s)))}
      errors={errors}
      warnings={warningsFor(selected)}
    />
  ) : null;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1400, mx: 'auto', minWidth: 0 }}>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/runbooks" underline="hover">
          Runbooks
        </Link>
        {!isNew && (
          <Link component={RouterLink} to={`/runbooks/${id}`} underline="hover">
            {meta.name || 'Runbook'}
          </Link>
        )}
        <Typography color="text.primary">{isNew ? 'New' : 'Edit'}</Typography>
      </Breadcrumbs>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h4" component="h1">
          {isNew ? 'New runbook' : `Edit runbook${baseVersion ? ` (v${baseVersion})` : ''}`}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {!isNew && (
            <Button startIcon={<HistoryIcon />} onClick={() => setHistoryOpen(true)}>
              History
            </Button>
          )}
          <Button variant="outlined" onClick={() => void validate()} disabled={busy !== null}>
            {busy === 'validate' ? 'Validating…' : 'Validate'}
          </Button>
          <Button variant="contained" onClick={() => void save()} disabled={busy !== null || !meta.name.trim() || (!dirty && !isNew)}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </Button>
        </Stack>
      </Stack>

      {formError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setFormError(null)}>
          {formError}
        </Alert>
      )}
      {errors._root && <Alert severity="error" sx={{ mb: 2 }}>{errors._root}</Alert>}

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Name"
                required
                size="small"
                value={meta.name}
                onChange={(e) => setMeta({ ...meta, name: e.target.value })}
                slotProps={{ htmlInput: { maxLength: 120 } }}
                error={Boolean(errors.name)}
                helperText={errors.name}
                fullWidth
              />
              <Autocomplete
                multiple
                freeSolo
                options={[]}
                value={meta.tags}
                onChange={(_e, tags) => setMeta({ ...meta, tags: tags as string[] })}
                renderInput={(params) => <TextField {...params} size="small" label="Tags" helperText="Type and press Enter" />}
                sx={{ flex: 1, minWidth: 0 }}
                fullWidth
              />
            </Stack>
            <TextField label="Description" size="small" multiline minRows={2} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
            <TextField label="What changed (optional)" size="small" value={changelog} onChange={(e) => setChangelog(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} helperText="Saved with the new version" />
          </Stack>
        </CardContent>
      </Card>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(280px, 380px) 1fr' }, gap: 2, mb: 2, minWidth: 0 }}>
        <Box sx={{ minWidth: 0 }} component="section" aria-labelledby="builder-steps">
          <Typography id="builder-steps" variant="h6" component="h2" sx={{ mb: 1 }}>
            Steps
          </Typography>
          <StepList
            steps={steps}
            selected={selected}
            onSelect={(index) => {
              setSelected(index);
              if (phone) setEditorOpen(true);
            }}
            onMove={(index, delta) => {
              setSteps(move(steps, index, delta));
              setSelected(index + delta);
            }}
            onRemove={(index) => {
              setSteps(steps.filter((_, i) => i !== index));
              setSelected((s) => Math.max(0, Math.min(s, steps.length - 2)));
            }}
            onAdd={(kind) => {
              setSteps([...steps, newStep(kind, steps)]);
              setSelected(steps.length);
              if (phone) setEditorOpen(true);
            }}
            errorCount={errorCount}
            warningCount={(index) => warningsFor(index).length}
          />
          {errors.steps && <Alert severity="error" sx={{ mt: 1 }}>{errors.steps}</Alert>}
        </Box>
        {!phone && (
          <Card variant="outlined" sx={{ minWidth: 0 }}>
            <CardContent>{editor}</CardContent>
          </Card>
        )}
      </Box>

      <Accordion variant="outlined" disableGutters defaultExpanded={definition.parameters.length > 0}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6" component="h2">
            Parameters ({definition.parameters.length})
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <ParametersEditor parameters={definition.parameters} onChange={(parameters) => setDefinition((d) => ({ ...d, parameters }))} errors={errors} />
        </AccordionDetails>
      </Accordion>
      <Accordion variant="outlined" disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6" component="h2">
            Default targets
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <TargetPicker
            value={toTargetValue(definition.defaultTargets)}
            onChange={(value) => setDefinition((d) => ({ ...d, defaultTargets: { ...d.defaultTargets, ...value } }))}
          />
        </AccordionDetails>
      </Accordion>
      <Accordion variant="outlined" disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6" component="h2">
            Strategy
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <StrategyFields
            value={definition.strategy}
            onChange={(strategy) => setDefinition((d) => ({ ...d, strategy: { ...d.strategy, ...strategy } as RunbookDefinition['strategy'] }))}
            errors={errors}
          />
        </AccordionDetails>
      </Accordion>

      {phone && (
        <Dialog fullScreen open={editorOpen} onClose={() => setEditorOpen(false)} aria-labelledby="step-editor-title">
          <DialogTitle id="step-editor-title">Step {selected + 1}</DialogTitle>
          <DialogContent dividers>{editor}</DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={() => setEditorOpen(false)}>
              Done
            </Button>
          </DialogActions>
        </Dialog>
      )}

      <Dialog open={conflict} onClose={() => setConflict(false)} aria-labelledby="conflict-title">
        <DialogTitle id="conflict-title">Someone saved a newer version</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This runbook changed since you opened it. Reload to see the newest version (your edits are dropped), or overwrite
            it with your edits as the next version.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConflict(false)}>Cancel</Button>
          <Button onClick={() => void reload()}>Reload</Button>
          <Button color="warning" variant="contained" onClick={() => void overwrite()}>
            Overwrite
          </Button>
        </DialogActions>
      </Dialog>

      {!isNew && id && <VersionHistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} runbookId={id} />}
      <Snackbar open={Boolean(notice)} autoHideDuration={4000} onClose={() => setNotice(null)} message={notice ?? ''} />
    </Box>
  );
}
