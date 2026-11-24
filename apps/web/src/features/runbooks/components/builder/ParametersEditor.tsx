/**
 * The parameters panel of the builder (issue #65): name, type, required, default and options per
 * parameter. A `secret` parameter has no default (a secret never lives in a definition): the
 * panel lists the organization's runbook secrets by name and creates a new one inline with the
 * platform's write-only `SecretField`. The value goes to `PUT /api/runbook-secrets/:name` and is
 * never read back.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import { SecretField } from '@marinoscar/platform-web/credentials/ui';
import { listRunbookSecrets, putRunbookSecret } from '../../api/runbooksApi';
import type { RunbookParameter, RunbookSecret } from '../../api/types';
import { errorMessage } from '../../hooks/useAsync';
import { newParameter } from '../../lib/builder';

export interface ParametersEditorProps {
  parameters: readonly RunbookParameter[];
  onChange: (parameters: RunbookParameter[]) => void;
  errors: Record<string, string>;
}

const SECRET_NAME = /^[a-z][a-z0-9_-]{0,63}$/;

function NewSecretForm({ onSaved }: { onSaved: (secret: RunbookSecret) => void }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameError = name && !SECRET_NAME.test(name) ? 'Lower-case letters, digits, "_" or "-", starting with a letter' : null;
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await putRunbookSecret(name, { value });
      setName('');
      setValue('');
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err, 'Could not save the secret'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Stack spacing={1.5} component="form" aria-label="New secret" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <TextField size="small" label="Secret name" value={name} onChange={(e) => setName(e.target.value)} error={Boolean(nameError)} helperText={nameError ?? 'How runs refer to it'} />
      <SecretField label="Secret value" value={value} onChange={setValue} noun="secret" emptyHelp="Write-only: it is never shown again" />
      {error && <Alert severity="error">{error}</Alert>}
      <Box>
        <Button type="submit" variant="outlined" size="small" disabled={saving || !name || Boolean(nameError) || !value}>
          {saving ? 'Saving…' : 'Save secret'}
        </Button>
      </Box>
    </Stack>
  );
}

export function ParametersEditor({ parameters, onChange, errors }: ParametersEditorProps) {
  const [secrets, setSecrets] = useState<RunbookSecret[]>([]);
  const [showNewSecret, setShowNewSecret] = useState(false);
  const hasSecretParam = parameters.some((p) => p.type === 'secret');

  useEffect(() => {
    if (!hasSecretParam) return;
    listRunbookSecrets()
      .then(setSecrets)
      .catch(() => setSecrets([]));
  }, [hasSecretParam]);

  const update = (index: number, patch: Partial<RunbookParameter>) =>
    onChange(parameters.map((p, i) => (i === index ? ({ ...p, ...patch } as RunbookParameter) : p)));
  const changeType = (index: number, type: RunbookParameter['type']) => {
    const { default: _d, options: _o, pattern: _p, ...rest } = parameters[index]!;
    void _d;
    void _o;
    void _p;
    onChange(parameters.map((p, i) => (i === index ? ({ ...rest, type, ...(type === 'enum' ? { options: [] } : {}) } as RunbookParameter) : p)));
  };
  const err = (index: number, field: string) => errors[`parameters.${index}.${field}`];

  return (
    <Stack spacing={2}>
      {parameters.length === 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          No parameters. Each one reaches the commands as an environment variable of the same name.
        </Typography>
      )}
      {parameters.map((p, index) => (
        <Card key={index} variant="outlined" component="fieldset" aria-label={`Parameter ${p.name}`} sx={{ m: 0, p: 0 }}>
          <CardContent>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField size="small" label="Name" value={p.name} onChange={(e) => update(index, { name: e.target.value.toUpperCase() })} error={Boolean(err(index, 'name'))} helperText={err(index, 'name') ?? 'UPPER_SNAKE_CASE'} fullWidth />
                <TextField size="small" label="Label" value={p.label ?? ''} onChange={(e) => update(index, { label: e.target.value || undefined })} fullWidth />
                <TextField select size="small" label="Type" value={p.type} onChange={(e) => changeType(index, e.target.value as RunbookParameter['type'])} sx={{ minWidth: 140 }}>
                  {['string', 'number', 'boolean', 'enum', 'secret'].map((t) => (
                    <MenuItem key={t} value={t}>
                      {t}
                    </MenuItem>
                  ))}
                </TextField>
                <IconButton aria-label={`Remove parameter ${p.name}`} onClick={() => onChange(parameters.filter((_, i) => i !== index))} sx={{ alignSelf: 'center' }}>
                  <DeleteOutlinedIcon />
                </IconButton>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                <FormControlLabel control={<Switch checked={p.required} onChange={(e) => update(index, { required: e.target.checked })} />} label="Required" />
                {p.type === 'string' && (
                  <>
                    <TextField size="small" label="Default" value={(p.default as string | undefined) ?? ''} onChange={(e) => update(index, { default: e.target.value || undefined })} error={Boolean(err(index, 'default'))} helperText={err(index, 'default')} fullWidth />
                    <TextField size="small" label="Pattern (RE2)" value={p.pattern ?? ''} onChange={(e) => update(index, { pattern: e.target.value || undefined })} error={Boolean(err(index, 'pattern'))} helperText={err(index, 'pattern')} fullWidth />
                  </>
                )}
                {p.type === 'number' && (
                  <TextField size="small" type="number" label="Default" value={(p.default as number | undefined) ?? ''} onChange={(e) => update(index, { default: e.target.value === '' ? undefined : Number(e.target.value) })} error={Boolean(err(index, 'default'))} helperText={err(index, 'default')} />
                )}
                {p.type === 'boolean' && (
                  <FormControlLabel control={<Switch checked={p.default === true} onChange={(e) => update(index, { default: e.target.checked })} />} label="On by default" />
                )}
                {p.type === 'enum' && (
                  <>
                    <Autocomplete
                      multiple
                      freeSolo
                      options={[]}
                      value={p.options ?? []}
                      onChange={(_e, options) => update(index, { options: options as string[] })}
                      renderInput={(params) => <TextField {...params} size="small" label="Options" error={Boolean(err(index, 'options'))} helperText={err(index, 'options') ?? 'Type and press Enter'} />}
                      sx={{ flex: 2, minWidth: 0 }}
                    />
                    <TextField select size="small" label="Default" value={(p.default as string | undefined) ?? ''} onChange={(e) => update(index, { default: e.target.value || undefined })} error={Boolean(err(index, 'default'))} helperText={err(index, 'default')} sx={{ flex: 1, minWidth: 140 }}>
                      <MenuItem value="">None</MenuItem>
                      {(p.options ?? []).map((o) => (
                        <MenuItem key={o} value={o}>
                          {o}
                        </MenuItem>
                      ))}
                    </TextField>
                  </>
                )}
                {p.type === 'secret' && (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Each run picks a runbook secret by name; the value never appears in the runbook.
                  </Typography>
                )}
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ))}
      <Box>
        <Button startIcon={<AddIcon />} onClick={() => onChange([...parameters, newParameter(parameters)])} disabled={parameters.length >= 30}>
          Add parameter
        </Button>
      </Box>
      {hasSecretParam && (
        <Card variant="outlined" component="section" aria-labelledby="runbook-secrets-heading">
          <CardContent>
            <Typography id="runbook-secrets-heading" variant="subtitle2" component="h4" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <KeyOutlinedIcon fontSize="small" aria-hidden="true" /> Runbook secrets
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
              {secrets.length === 0 ? (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  None yet.
                </Typography>
              ) : (
                secrets.map((s) => <Chip key={s.name} size="small" label={s.label ? `${s.label} (${s.name})` : s.name} />)
              )}
            </Box>
            {showNewSecret ? (
              <NewSecretForm
                onSaved={(saved) => {
                  setSecrets((current) => [...current.filter((s) => s.name !== saved.name), saved]);
                  setShowNewSecret(false);
                }}
              />
            ) : (
              <Button size="small" startIcon={<AddIcon />} onClick={() => setShowNewSecret(true)}>
                New secret
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
