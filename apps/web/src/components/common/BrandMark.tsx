/**
 * The ShellKeep mark (Option A, #148): a shell prompt (`>_`) in a rounded
 * rectangle, stroked in the theme's primary colour (the brand accent), so it
 * follows light and dark. Decorative: the product name always sits beside it.
 */
import { Box, type SxProps, type Theme } from '@mui/material';

export interface BrandMarkProps {
  /** Width and height in pixels. Default 24. */
  size?: number;
  sx?: SxProps<Theme>;
}

export function BrandMark({ size = 24, sx }: BrandMarkProps) {
  return (
    <Box
      component="svg"
      data-testid="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      sx={[{ color: 'primary.main', flexShrink: 0, display: 'block' }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7 9l3 3-3 3M12 15h5" />
    </Box>
  );
}

/** The AppBar brand: the mark and the product name. */
export function BrandLockup({ name }: { name: string }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      <BrandMark size={24} />
      <span>{name}</span>
    </Box>
  );
}
