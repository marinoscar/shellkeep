/**
 * The run parameters form (issue #65), generated from a definition's `parameters`: a text field
 * (with the pattern as a hint), a number field, a switch, a select of the options, and for a
 * `secret` a select of the organization's runbook secrets BY NAME. A secret value is never typed
 * here and never shown: the run carries only the credential's name (`secretRefs`).
 */
import { FormControl, FormControlLabel, FormHelperText, InputLabel, MenuItem, Select, Stack, Switch, TextField } from '@mui/material';
import type { RunbookParameter, RunbookSecret } from '../api/types';

export type ParamValues = Record<string, string | number | boolean>;

export interface ParamsFormProps {
  parameters: readonly RunbookParameter[];
  values: ParamValues;
  secretRefs: Record<string, string>;
  secrets: readonly RunbookSecret[];
  errors?: Record<string, string>;
  onChange: (values: ParamValues) => void;
  onSecretRefsChange: (refs: Record<string, string>) => void;
}

/** The starting values of a form: each parameter's default, `false` for an unset boolean. */
export function initialParamValues(parameters: readonly RunbookParameter[]): ParamValues {
  const values: ParamValues = {};
  for (const p of parameters) {
    if (p.type === 'secret') continue;
    if (p.default !== undefined) values[p.name] = p.default;
    else if (p.type === 'boolean') values[p.name] = false;
  }
  return values;
}

/** Client-side checks before the API's own (required, number, pattern hint only). */
export function validateParams(
  parameters: readonly RunbookParameter[],
  values: ParamValues,
  secretRefs: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const p of parameters) {
    if (p.type === 'secret') {
      if (p.required && !secretRefs[p.name]) errors[p.name] = 'Choose a secret';
      continue;
    }
    const value = values[p.name];
    const empty = value === undefined || value === '';
    if (p.required && empty && p.type !== 'boolean') errors[p.name] = 'Required';
    else if (p.type === 'number' && !empty && !Number.isFinite(Number(value))) errors[p.name] = 'Enter a number';
  }
  return errors;
}

/** The `params` body of a run: numbers as numbers, empty optional values left out. */
export function toRunParams(parameters: readonly RunbookParameter[], values: ParamValues): ParamValues {
  const out: ParamValues = {};
  for (const p of parameters) {
    if (p.type === 'secret') continue;
    const value = values[p.name];
    if (value === undefined || value === '') continue;
    out[p.name] = p.type === 'number' ? Number(value) : value;
  }
  return out;
}

export function ParamsForm({ parameters, values, secretRefs, secrets, errors = {}, onChange, onSecretRefsChange }: ParamsFormProps) {
  if (parameters.length === 0) return null;
  const set = (name: string, value: string | number | boolean) => onChange({ ...values, [name]: value });
  return (
    <Stack spacing={2}>
      {parameters.map((p) => {
        const label = `${p.label || p.name}${p.required ? ' *' : ''}`;
        const help = errors[p.name] ?? p.description ?? (p.pattern ? `Must match ${p.pattern}` : undefined);
        const id = `param-${p.name}`;
        switch (p.type) {
          case 'boolean':
            return (
              <FormControl key={p.name} error={Boolean(errors[p.name])}>
                <FormControlLabel
                  control={<Switch checked={Boolean(values[p.name])} onChange={(e) => set(p.name, e.target.checked)} />}
                  label={label}
                />
                {help && <FormHelperText>{help}</FormHelperText>}
              </FormControl>
            );
          case 'enum':
            return (
              <FormControl key={p.name} fullWidth size="small" error={Boolean(errors[p.name])}>
                <InputLabel id={`${id}-label`}>{label}</InputLabel>
                <Select
                  labelId={`${id}-label`}
                  label={label}
                  value={(values[p.name] as string | undefined) ?? ''}
                  onChange={(e) => set(p.name, e.target.value)}
                >
                  {(p.options ?? []).map((option) => (
                    <MenuItem key={option} value={option}>
                      {option}
                    </MenuItem>
                  ))}
                </Select>
                {help && <FormHelperText>{help}</FormHelperText>}
              </FormControl>
            );
          case 'secret':
            return (
              <FormControl key={p.name} fullWidth size="small" error={Boolean(errors[p.name])}>
                <InputLabel id={`${id}-label`}>{label}</InputLabel>
                <Select
                  labelId={`${id}-label`}
                  label={label}
                  value={secretRefs[p.name] ?? ''}
                  onChange={(e) => onSecretRefsChange({ ...secretRefs, [p.name]: e.target.value })}
                >
                  {secrets.map((secret) => (
                    <MenuItem key={secret.name} value={secret.name}>
                      {secret.label ? `${secret.label} (${secret.name})` : secret.name}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>{errors[p.name] ?? p.description ?? 'A runbook secret, by name: the value never leaves the server'}</FormHelperText>
              </FormControl>
            );
          default:
            return (
              <TextField
                key={p.name}
                id={id}
                size="small"
                fullWidth
                label={label}
                type={p.type === 'number' ? 'number' : 'text'}
                value={values[p.name] ?? ''}
                onChange={(e) => set(p.name, e.target.value)}
                error={Boolean(errors[p.name])}
                helperText={help}
              />
            );
        }
      })}
    </Stack>
  );
}
