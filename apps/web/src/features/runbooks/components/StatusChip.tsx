import { Chip } from '@mui/material';
import { statusMeta } from '../lib/statusMeta';

/** A status as a chip: its icon and its label, coloured from the theme (never colour alone). */
export function StatusChip({ status, size = 'small' }: { status: string; size?: 'small' | 'medium' }) {
  const meta = statusMeta(status);
  const { Icon } = meta;
  return (
    <Chip
      size={size}
      variant="outlined"
      color={meta.tone}
      icon={<Icon aria-hidden="true" />}
      label={meta.label}
      data-status={status}
    />
  );
}
