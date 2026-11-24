/**
 * The run strategy fields (issue #65), shared by the builder (the definition's strategy) and the
 * launcher (per-run overrides): concurrency, wave size, the failure budget as a count or a
 * percentage, abort in-flight and the canary pause.
 */
import { FormControlLabel, MenuItem, Stack, Switch, TextField } from '@mui/material';
import type { RunStrategy } from '../api/types';

export interface StrategyFieldsProps {
  value: Partial<RunStrategy>;
  onChange: (value: Partial<RunStrategy>) => void;
  errors?: Record<string, string>;
  /** Prefix of the error keys (`strategy`). */
  errorPrefix?: string;
}

const intOrUndefined = (text: string): number | undefined => (text === '' ? undefined : Math.trunc(Number(text)));

export function StrategyFields({ value, onChange, errors = {}, errorPrefix = 'strategy' }: StrategyFieldsProps) {
  const budget = value.maxFailures ?? { count: 0 };
  const budgetMode = 'percent' in budget ? 'percent' : 'count';
  const budgetValue = 'percent' in budget ? budget.percent : budget.count;
  const err = (field: string) => errors[`${errorPrefix}.${field}`];
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          size="small"
          type="number"
          label="Concurrency"
          value={value.concurrency ?? ''}
          onChange={(e) => onChange({ ...value, concurrency: intOrUndefined(e.target.value) })}
          slotProps={{ htmlInput: { min: 1, max: 50 } }}
          helperText={err('concurrency') ?? 'Servers in flight at once'}
          error={Boolean(err('concurrency'))}
          fullWidth
        />
        <TextField
          size="small"
          type="number"
          label="Wave size"
          value={value.batchSize ?? ''}
          onChange={(e) => onChange({ ...value, batchSize: intOrUndefined(e.target.value) })}
          slotProps={{ htmlInput: { min: 1, max: 500 } }}
          helperText={err('batchSize') ?? 'Empty: a sliding window'}
          error={Boolean(err('batchSize'))}
          fullWidth
        />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          select
          size="small"
          label="Failure budget"
          value={budgetMode}
          onChange={(e) =>
            onChange({ ...value, maxFailures: e.target.value === 'percent' ? { percent: budgetValue } : { count: Math.trunc(budgetValue) } })
          }
          fullWidth
        >
          <MenuItem value="count">Failed servers (count)</MenuItem>
          <MenuItem value="percent">Failed servers (%)</MenuItem>
        </TextField>
        <TextField
          size="small"
          type="number"
          label={budgetMode === 'percent' ? 'Max failed %' : 'Max failed servers'}
          value={budgetValue}
          onChange={(e) => {
            const n = Number(e.target.value || 0);
            onChange({ ...value, maxFailures: budgetMode === 'percent' ? { percent: n } : { count: Math.trunc(n) } });
          }}
          slotProps={{ htmlInput: { min: 0, max: budgetMode === 'percent' ? 100 : undefined } }}
          helperText={err('maxFailures') ?? (budgetMode === 'count' && budgetValue === 0 ? '0 is fail-fast' : ' ')}
          error={Boolean(err('maxFailures'))}
          fullWidth
        />
      </Stack>
      <FormControlLabel
        control={<Switch checked={Boolean(value.abortInFlight)} onChange={(e) => onChange({ ...value, abortInFlight: e.target.checked })} />}
        label="Abort servers in flight when the budget is spent"
      />
      <FormControlLabel
        control={
          <Switch
            checked={Boolean(value.pauseAfterFirstBatch)}
            onChange={(e) => onChange({ ...value, pauseAfterFirstBatch: e.target.checked })}
          />
        }
        label="Canary: pause after the first wave"
      />
    </Stack>
  );
}
