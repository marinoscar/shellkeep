/**
 * The login route (issue #47): the packaged `LoginPage` with this app's mark
 * and name in its `Logo` slot.
 *
 * The page owns the flow (redirect once signed in, the session-expired notice,
 * one button per provider the API offers); this app owns only what identifies
 * the product. The mark is decorative: "Welcome" is already the page's `h1`.
 */

import { Box, Typography } from '@mui/material';
import { LoginPage as PackagedLoginPage } from '@marinoscar/platform-web/identity/ui';
import type { LoginPageSlots } from '@marinoscar/platform-web/identity/ui';
import { APP_NAME } from '../config/app';

function AppLogo() {
  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 2 }}
      data-testid="login-logo"
    >
      <Box
        component="img"
        src="/pwa-192x192.png"
        alt=""
        aria-hidden="true"
        sx={{ width: 56, height: 56, borderRadius: 2 }}
      />
      <Typography
        variant="subtitle1"
        component="p"
        sx={{ mt: 1, fontWeight: 600, letterSpacing: 0.5 }}
      >
        {APP_NAME}
      </Typography>
    </Box>
  );
}

/** A module constant: the package keys on slot identity. */
const LOGIN_SLOTS: LoginPageSlots = { Logo: AppLogo };

export default function LoginPage() {
  return <PackagedLoginPage slots={LOGIN_SLOTS} />;
}
