/**
 * The "Version x.y.z" line at the foot of both settings hubs (issue #147).
 *
 * It answers "what am I running" for every signed-in user. The About page
 * (`/admin/settings/about`) is gated on `system_settings:read`, so a Viewer or
 * a Contributor otherwise sees the version only in the user menu. It asks the
 * API nothing, gates on nothing and reads no breakpoint of its own (the five
 * coupled gates are untouched), so it looks the same at every width. It never
 * claims to be the deployed revision; About stays authoritative for that.
 *
 * PLATFORM-ADOPTION-SHIM(#147): the packaged hub
 * (`@marinoscar/platform-web/settings/ui`) has no footer slot, so the two page
 * bindings render this line as a SIBLING after the hub. The negative top margin
 * cancels the hub's own bottom padding (`p: { xs: 2, md: 4 }`) so the line sits
 * at the hub's foot. Remove it when the package grows a footer slot.
 *
 * The version is `APP_VERSION` (`config/app.ts`, this package's `package.json`),
 * the same value the user menu's footer shows.
 */

import { Box, Divider, Typography } from '@mui/material';
import { APP_VERSION } from '../../config/app';

export function AppVersionLine() {
  return (
    <Box sx={{ px: { xs: 2, md: 4 }, pb: { xs: 2, md: 4 }, mt: { xs: -2, md: -4 } }}>
      <Divider sx={{ mb: 1.5 }} />
      <Typography
        variant="caption"
        color="text.secondary"
        component="p"
        sx={{ m: 0 }}
        data-testid="app-version-line"
      >
        {`Version ${APP_VERSION}`}
      </Typography>
    </Box>
  );
}
