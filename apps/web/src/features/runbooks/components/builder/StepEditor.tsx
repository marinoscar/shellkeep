/**
 * The step editor of the builder (issue #65): the fields every step has (id, name, when,
 * continue on error, timeout), then the kind's own fields. Field errors come from the API's
 * validation, keyed by JSON path (`steps.<index>.<field>`); warnings (including #67's
 * destructive-step warnings, which arrive on the same channel) show inline above the fields.
 */
import { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import { storageObjects, storageErrorMessage } from '../../../../services/storage';
import type { DefinitionWarning, RunbookStep } from '../../api/types';
import { stepKindMeta } from '../../lib/stepKinds';

export interface StepEditorProps {
  step: RunbookStep;
  index: number;
  onChange: (step: RunbookStep) => void;
  errors: Record<string, string>;
  warnings: readonly DefinitionWarning[];
}

const MONO = { fontFamily: 'monospace', fontSize: 13 };
const MIB = 2 ** 20;

/** A multiline monospace editor with line numbers: a plain `TextField`, no code editor dependency. */
function CodeField({ label, value, onChange, error, minRows = 8 }: { label: string; value: string; onChange: (v: string) => void; error?: string; minRows?: number }) {
  const lines = Math.max(value.split('\n').length, minRows);
  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', minWidth: 0 }}>
      <Box
        aria-hidden="true"
        sx={{ ...MONO, lineHeight: '1.4375em', pt: '16.5px', pr: 1, textAlign: 'right', color: 'text.disabled', userSelect: 'none', minWidth: 32 }}
      >
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </Box>
      <TextField
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        multiline
        minRows={minRows}
        fullWidth
        error={Boolean(error)}
        helperText={error}
        slotProps={{ htmlInput: { spellCheck: false, style: { ...MONO, whiteSpace: 'pre', overflowX: 'auto' } } }}
      />
    </Box>
  );
}

function ChipsField({ label, value, onChange, error, helper, options = [] }: { label: string; value: string[]; onChange: (v: string[]) => void; error?: string; helper?: string; options?: string[] }) {
  return (
    <Autocomplete
      multiple
      freeSolo
      options={options}
      value={value}
      onChange={(_e, next) => onChange(next as string[])}
      renderValue={(values, getItemProps) => values.map((option, i) => <Chip size="small" label={option} {...getItemProps({ index: i })} key={option} />)}
      renderInput={(params) => <TextField {...params} size="small" label={label} error={Boolean(error)} helperText={error ?? helper ?? 'Type and press Enter'} />}
    />
  );
}

export function StepEditor({ step, index, onChange, errors, warnings }: StepEditorProps) {
  const err = (field: string) => errors[`steps.${index}.${field}`];
  const set = (patch: Partial<RunbookStep>) => onChange({ ...step, ...patch } as RunbookStep);
  const meta = stepKindMeta(step.kind);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const runAs = 'runAs' in step ? step.runAs : undefined;
  const runAsFields = runAs && (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
      <FormControlLabel
        control={<Switch checked={runAs.sudo} onChange={(e) => set({ runAs: { ...runAs, sudo: e.target.checked } } as Partial<RunbookStep>)} />}
        label="Run with sudo"
      />
      <TextField
        size="small"
        label="As user (optional)"
        value={runAs.user ?? ''}
        onChange={(e) => set({ runAs: { ...runAs, user: e.target.value || undefined } } as Partial<RunbookStep>)}
        error={Boolean(err('runAs.user'))}
        helperText={err('runAs.user')}
      />
    </Stack>
  );

  const exitCodes = 'successExitCodes' in step && (
    <TextField
      size="small"
      label="Success exit codes"
      value={step.successExitCodes.join(', ')}
      onChange={(e) =>
        set({
          successExitCodes: e.target.value
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
            .map(Number)
            .filter((n) => Number.isInteger(n)),
        } as Partial<RunbookStep>)
      }
      error={Boolean(err('successExitCodes'))}
      helperText={err('successExitCodes') ?? 'Comma separated, 0 to 255'}
    />
  );

  const upload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const object = await storageObjects.uploadAndWait(file, { filename: file.name });
      set({ storageObjectId: object.id } as Partial<RunbookStep>);
    } catch (error) {
      setUploadError(storageErrorMessage(error, 'The upload failed'));
    } finally {
      setUploading(false);
    }
  };

  let kindFields: React.ReactNode = null;
  switch (step.kind) {
    case 'command':
      kindFields = (
        <>
          <TextField
            label="Command"
            value={step.command}
            onChange={(e) => set({ command: e.target.value })}
            multiline
            minRows={3}
            fullWidth
            error={Boolean(err('command'))}
            helperText={err('command') ?? 'Parameters arrive as environment variables, for example $PARAM_1'}
            slotProps={{ htmlInput: { spellCheck: false, style: MONO } }}
          />
          <TextField size="small" label="Working directory (optional)" value={step.workdir ?? ''} onChange={(e) => set({ workdir: e.target.value || undefined })} error={Boolean(err('workdir'))} helperText={err('workdir')} />
          {exitCodes}
          {runAsFields}
        </>
      );
      break;
    case 'script':
      kindFields = (
        <>
          <TextField select size="small" label="Interpreter" value={step.interpreter} onChange={(e) => set({ interpreter: e.target.value as typeof step.interpreter })} sx={{ maxWidth: 220 }}>
            <MenuItem value="bash">bash</MenuItem>
            <MenuItem value="sh">sh</MenuItem>
            <MenuItem value="python3">python3</MenuItem>
          </TextField>
          <CodeField label="Script" value={step.body} onChange={(body) => set({ body })} error={err('body')} />
          <ChipsField label="Arguments" value={step.args} onChange={(args) => set({ args })} error={err('args')} />
          {exitCodes}
          {runAsFields}
        </>
      );
      break;
    case 'package_update':
      kindFields = (
        <>
          <TextField
            select
            size="small"
            label="Package manager"
            value={step.manager}
            onChange={(e) => set({ manager: e.target.value as typeof step.manager })}
            helperText={step.manager === 'auto' ? 'Auto-detected per server from its facts' : undefined}
            sx={{ maxWidth: 320 }}
          >
            {['auto', 'apt', 'dnf', 'yum', 'apk', 'zypper', 'brew'].map((m) => (
              <MenuItem key={m} value={m}>
                {m === 'auto' ? 'Auto-detect' : m}
              </MenuItem>
            ))}
          </TextField>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={step.packages === 'all' ? 'all' : 'some'}
            onChange={(_e, v) => v && set({ packages: v === 'all' ? 'all' : [] })}
            aria-label="Which packages"
          >
            <ToggleButton value="all">All packages</ToggleButton>
            <ToggleButton value="some">Named packages</ToggleButton>
          </ToggleButtonGroup>
          {step.packages !== 'all' && <ChipsField label="Packages" value={step.packages} onChange={(packages) => set({ packages })} error={err('packages')} />}
          <FormControlLabel control={<Switch checked={step.refreshIndex} onChange={(e) => set({ refreshIndex: e.target.checked })} />} label="Refresh the package index first" />
          <FormControlLabel control={<Switch checked={step.securityOnly} onChange={(e) => set({ securityOnly: e.target.checked })} />} label="Security updates only (apt, dnf, yum)" />
          {runAsFields}
        </>
      );
      break;
    case 'file_upload':
      kindFields = (
        <>
          <Stack useFlexGap direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
            <Button component="label" variant="outlined" startIcon={<UploadFileOutlinedIcon />} disabled={uploading}>
              {uploading ? 'Uploading…' : step.storageObjectId ? 'Replace file' : 'Choose file'}
              <input
                hidden
                type="file"
                aria-label="File to upload"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
            </Button>
            <Typography variant="body2" sx={{ color: err('storageObjectId') ? 'error.main' : 'text.secondary', overflowWrap: 'anywhere' }}>
              {err('storageObjectId') ?? (step.storageObjectId ? `Stored file ${step.storageObjectId.slice(0, 8)}…` : 'No file yet')}
            </Typography>
          </Stack>
          {uploadError && <Alert severity="error">{uploadError}</Alert>}
          <TextField size="small" label="Destination path" value={step.destPath} onChange={(e) => set({ destPath: e.target.value })} error={Boolean(err('destPath'))} helperText={err('destPath') ?? 'Absolute, for example /etc/app/config.yml'} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField size="small" label="Mode" value={step.mode} onChange={(e) => set({ mode: e.target.value })} error={Boolean(err('mode'))} helperText={err('mode') ?? 'Octal, for example 0644'} />
            <TextField size="small" label="Owner (optional)" value={step.owner ?? ''} onChange={(e) => set({ owner: e.target.value || undefined })} error={Boolean(err('owner'))} helperText={err('owner') ?? 'user or user:group'} />
          </Stack>
          <FormControlLabel control={<Switch checked={step.overwrite} onChange={(e) => set({ overwrite: e.target.checked })} />} label="Replace an existing file" />
          {runAsFields}
        </>
      );
      break;
    case 'collect_logs':
      kindFields = (
        <>
          <ChipsField label="Paths" value={step.paths} onChange={(paths) => set({ paths })} error={err('paths')} helper="Absolute paths of files to collect" />
          <ChipsField label="Journal units" value={step.journalUnits} onChange={(journalUnits) => set({ journalUnits })} error={err('journalUnits')} helper="systemd units, for example nginx.service" />
          <TextField size="small" label="Since (optional)" value={step.since ?? ''} onChange={(e) => set({ since: e.target.value || undefined })} error={Boolean(err('since'))} helperText={err('since') ?? 'For example 24h, 30m, 7d'} sx={{ maxWidth: 240 }} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField size="small" type="number" label="Max MiB per file" value={Math.round(step.maxBytesPerFile / MIB)} onChange={(e) => set({ maxBytesPerFile: Math.max(1, Number(e.target.value)) * MIB })} error={Boolean(err('maxBytesPerFile'))} helperText={err('maxBytesPerFile')} />
            <TextField size="small" type="number" label="Max MiB in total" value={Math.round(step.maxTotalBytes / MIB)} onChange={(e) => set({ maxTotalBytes: Math.max(1, Number(e.target.value)) * MIB })} error={Boolean(err('maxTotalBytes'))} helperText={err('maxTotalBytes')} />
          </Stack>
          {runAsFields}
        </>
      );
      break;
    case 'ai_task':
      kindFields = (
        <>
          <TextField label="Goal" value={step.goal} onChange={(e) => set({ goal: e.target.value })} multiline minRows={3} error={Boolean(err('goal'))} helperText={err('goal') ?? 'What the AI agent should achieve on each server'} />
          <TextField select size="small" label="Approval" value={step.approvalMode} onChange={(e) => set({ approvalMode: e.target.value as typeof step.approvalMode })} sx={{ maxWidth: 360 }}>
            <MenuItem value="per_command">Approve every command</MenuItem>
            <MenuItem value="plan">Approve the plan once</MenuItem>
            <MenuItem value="autonomous_within_allowlist">Autonomous within the allow list</MenuItem>
          </TextField>
          <ChipsField label="Allow (RE2 patterns)" value={step.allow} onChange={(allow) => set({ allow })} error={err('allow')} />
          <ChipsField label="Deny (RE2 patterns)" value={step.deny} onChange={(deny) => set({ deny })} error={err('deny')} />
          <TextField size="small" type="number" label="Max agent steps" value={step.maxSteps} onChange={(e) => set({ maxSteps: Number(e.target.value) })} error={Boolean(err('maxSteps'))} helperText={err('maxSteps')} sx={{ maxWidth: 200 }} />
          {runAsFields}
        </>
      );
      break;
    case 'approval_gate':
      kindFields = (
        <>
          <TextField select size="small" label="Scope" value={step.scope} onChange={(e) => set({ scope: e.target.value as typeof step.scope })} helperText="One approval for the whole run, or one per server" sx={{ maxWidth: 320 }}>
            <MenuItem value="run">Whole run</MenuItem>
            <MenuItem value="target">Each server</MenuItem>
          </TextField>
          <TextField label="Message to the approver" value={step.message} onChange={(e) => set({ message: e.target.value })} multiline minRows={2} error={Boolean(err('message'))} helperText={err('message')} />
          <TextField size="small" type="number" label="Expires after (hours)" value={step.expiresAfterSec / 3600} onChange={(e) => set({ expiresAfterSec: Math.round(Number(e.target.value) * 3600) })} error={Boolean(err('expiresAfterSec'))} helperText={err('expiresAfterSec') ?? 'Between 1 minute and 7 days'} sx={{ maxWidth: 240 }} />
        </>
      );
      break;
  }

  return (
    <Stack spacing={2} component="section" aria-label={`Edit step ${index + 1}`}>
      <Typography variant="subtitle1" component="h3" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <meta.Icon aria-hidden="true" /> {meta.label}
      </Typography>
      {warnings.map((w) => (
        <Alert key={`${w.code}-${w.path.join('.')}`} severity="warning">
          {w.message}
        </Alert>
      ))}
      {err('') && <Alert severity="error">{err('')}</Alert>}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField size="small" label="Name" value={step.name} onChange={(e) => set({ name: e.target.value })} error={Boolean(err('name'))} helperText={err('name')} fullWidth />
        <TextField size="small" label="Step id" value={step.id} onChange={(e) => set({ id: e.target.value })} error={Boolean(err('id'))} helperText={err('id') ?? 'lower-case, unique'} sx={{ minWidth: { sm: 200 } }} />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
        <TextField select size="small" label="Runs" value={step.when} onChange={(e) => set({ when: e.target.value as RunbookStep['when'] })} sx={{ minWidth: 180 }}>
          <MenuItem value="on_success">On success</MenuItem>
          <MenuItem value="on_failure">On failure</MenuItem>
          <MenuItem value="always">Always</MenuItem>
        </TextField>
        <TextField size="small" type="number" label="Timeout (seconds)" value={step.timeoutSec} onChange={(e) => set({ timeoutSec: Number(e.target.value) })} error={Boolean(err('timeoutSec'))} helperText={err('timeoutSec')} sx={{ minWidth: 160 }} />
        <FormControlLabel control={<Switch checked={step.continueOnError} onChange={(e) => set({ continueOnError: e.target.checked })} />} label="Continue on error" />
      </Stack>
      {kindFields}
    </Stack>
  );
}
