/**
 * ShellKeep's bodies for the platform `WelcomeDialog` (issue #70).
 *
 * The packaged dialog owns the chrome: the title, "Later" and the primary
 * button, the routing (an administrator to the Setup guide, everyone else to
 * Getting started), the "seen" write on every way out, and the accessibility
 * wiring. ShellKeep supplies the two bodies (`slots.userPane`, `slots.adminPane`):
 * one pane each, a sentence on what the product does and the short path to a
 * first working terminal. Data first, so the tests assert the claims.
 *
 * No breakpoint is read here: the dialog is sized by the platform.
 */

import type { ReactElement } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import type { WelcomePaneProps } from '@marinoscar/platform-web/onboarding/ui';

export interface WelcomePaneCopy {
  lead: string;
  points: readonly string[];
  closing: string;
}

export const USER_WELCOME: WelcomePaneCopy = {
  lead: 'Terminals in your browser that keep running when you close the tab: every session lives in tmux on your server, so you pick it up again from any device.',
  points: [
    'Add a server: its address, user and credentials, stored encrypted.',
    'Trust its host key, so a server that changes its key is refused.',
    'Open a session, then add your own AI key and write your first runbook when you want them.',
  ],
  closing: 'Your Getting started checklist tracks each step and links straight to the page that does it.',
};

export const ADMIN_WELCOME: WelcomePaneCopy = {
  lead: 'Before people can use this deployment, a few things must be configured: object storage, email delivery and the allowlist of who may sign in.',
  points: [
    'The Setup guide checks each one against the live deployment, through the Doctor.',
    'Web Push, AI and database backups are recommended next.',
    'Your own Getting started checklist (servers, sessions, runbooks) is in Settings.',
  ],
  closing: 'Nothing on the guide stops you looking around first.',
};

function WelcomeBody({ copy, descriptionId }: { copy: WelcomePaneCopy; descriptionId: string }): ReactElement {
  return (
    <Box id={descriptionId}>
      <Typography variant="body1">{copy.lead}</Typography>
      <Stack component="ul" spacing={1} sx={{ mt: 2, mb: 2, pl: 3 }}>
        {copy.points.map((point) => (
          <Typography component="li" variant="body2" color="text.secondary" key={point}>
            {point}
          </Typography>
        ))}
      </Stack>
      <Typography variant="body2">{copy.closing}</Typography>
    </Box>
  );
}

/** `slots.userPane` of the packaged `WelcomeDialog`. */
export const userWelcomePane = ({ descriptionId }: WelcomePaneProps): ReactElement => (
  <WelcomeBody copy={USER_WELCOME} descriptionId={descriptionId} />
);

/** `slots.adminPane` of the packaged `WelcomeDialog`. */
export const adminWelcomePane = ({ descriptionId }: WelcomePaneProps): ReactElement => (
  <WelcomeBody copy={ADMIN_WELCOME} descriptionId={descriptionId} />
);
