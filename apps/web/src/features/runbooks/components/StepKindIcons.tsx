import { Box, Tooltip } from '@mui/material';
import { stepKindMeta } from '../lib/stepKinds';

/** The kinds of a runbook's steps as a row of icons, each with its label for assistive tech. */
export function StepKindIcons({ kinds, max = 8 }: { kinds: readonly string[]; max?: number }) {
  const shown = kinds.slice(0, max);
  const label = kinds.length === 0 ? 'No steps' : `${kinds.length} steps: ${kinds.map((k) => stepKindMeta(k).label).join(', ')}`;
  return (
    <Box role="img" aria-label={label} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: 'text.secondary' }}>
      {shown.map((kind, index) => {
        const { Icon, label: kindLabel } = stepKindMeta(kind);
        return (
          <Tooltip key={`${kind}-${index}`} title={kindLabel}>
            <Icon fontSize="small" aria-hidden="true" />
          </Tooltip>
        );
      })}
      {kinds.length > max && (
        <Box component="span" sx={{ typography: 'caption', ml: 0.5 }} aria-hidden="true">
          +{kinds.length - max}
        </Box>
      )}
    </Box>
  );
}
