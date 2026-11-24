/**
 * The shell banner: "N of M required steps left" (issue #70).
 *
 * The platform onboarding slice ships the checklist pages and the welcome
 * dialog, and deliberately no banner: where "what is left to set up" sits in the
 * shell is the app's decision. This is ShellKeep's, over `useOnboarding()`
 * (`@marinoscar/platform-web/onboarding/headless`), mounted once in the
 * shell's `banners` (`components/common/Layout.tsx`).
 *
 * It renders NOTHING (no element, no spacing) while loading, for a read that
 * failed, once every required step is done, for anyone who dismissed the
 * checklist, and on the page it links to.
 *
 * ADMINISTRATOR FIRST. The deployment's Setup guide and the account's Getting
 * started are separate surfaces with separate dismissals (`adminDismissedAt`,
 * `checklistDismissedAt`). While the deployment has a required step open the
 * banner is about that; otherwise about the account's own required steps (add a
 * server, trust its host key, open a session).
 *
 * No breakpoint is read here: the shell owns the five coupled gates.
 */

import { useState } from 'react';
import { Box, Button, LinearProgress, Paper, Snackbar, Stack, Typography } from '@mui/material';
import RocketLaunchOutlinedIcon from '@mui/icons-material/RocketLaunchOutlined';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useOnboarding } from '@marinoscar/platform-web/onboarding/headless';
import type { OnboardingBlock, OnboardingResponse } from '@marinoscar/platform-web/onboarding/headless';
import { GETTING_STARTED_PATH, SETUP_GUIDE_PATH } from '@marinoscar/platform-web/onboarding/ui';
import { APP_NAME } from '../../config/app';

export type BannerAudience = 'admin' | 'user';

interface AudienceCopy {
  path: string;
  landmark: string;
  detail: string;
  dismissLabel: string;
  confirmation: string;
}

export const BANNER_COPY: Record<BannerAudience, AudienceCopy> = {
  admin: {
    path: SETUP_GUIDE_PATH,
    landmark: 'Deployment setup',
    detail: `Until they are done, the people using this ${APP_NAME} deployment cannot use the features behind them.`,
    dismissLabel: 'Dismiss the deployment setup checklist',
    confirmation: 'The Setup guide is still in the Console whenever you want it.',
  },
  user: {
    path: GETTING_STARTED_PATH,
    landmark: 'Getting started',
    detail: 'Add a server, trust its host key and open your first session. None of it takes long.',
    dismissLabel: 'Dismiss the getting started checklist',
    confirmation: 'Your checklist is still here whenever you want it: Settings, Getting started.',
  },
};

/** How many required steps a block has, and how many of them are not done. */
export function requiredProgress(block: OnboardingBlock) {
  const required = block.steps.filter((step) => step.tier === 'required');
  const remaining = required.filter((step) => step.status !== 'done').length;
  const total = required.length;
  return { total, remaining, percent: total === 0 ? 0 : ((total - remaining) / total) * 100 };
}

/** Which checklist the banner is about, or `null` when it has nothing to say. */
export function chooseBannerAudience(state: OnboardingResponse | null): BannerAudience | null {
  if (!state?.settings) return null;
  const outstanding = (block: OnboardingBlock | null, dismissedAt: string | null) =>
    Boolean(block && dismissedAt === null && requiredProgress(block).remaining > 0);
  if (outstanding(state.admin, state.settings.adminDismissedAt)) return 'admin';
  if (outstanding(state.user, state.settings.checklistDismissedAt)) return 'user';
  return null;
}

const TITLE_ID = 'onboarding-banner-title';

export function OnboardingBanner() {
  const { state, isLoading, dismissAdmin, dismissChecklist } = useOnboarding();
  const { pathname } = useLocation();
  // The confirmation outlives the banner it came from.
  const [dismissed, setDismissed] = useState<BannerAudience | null>(null);

  if (dismissed) {
    const copy = BANNER_COPY[dismissed];
    return (
      <Snackbar
        open
        autoHideDuration={8000}
        onClose={() => setDismissed(null)}
        message={copy.confirmation}
        action={
          <Button component={RouterLink} to={copy.path} color="inherit" size="small">
            Open
          </Button>
        }
      />
    );
  }

  if (isLoading) return null;
  const audience = chooseBannerAudience(state);
  const block = audience === 'admin' ? state?.admin : state?.user;
  if (!audience || !block) return null;

  const copy = BANNER_COPY[audience];
  // On the page it links to, the banner would point at itself.
  if (pathname === copy.path || pathname.startsWith(`${copy.path}/`)) return null;

  const { total, remaining, percent } = requiredProgress(block);
  const subject = audience === 'admin' ? APP_NAME : 'your account';

  return (
    <Paper component="section" variant="outlined" aria-labelledby={TITLE_ID} sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
        <Box aria-hidden sx={{ display: 'flex', color: 'primary.main' }}>
          <RocketLaunchOutlinedIcon />
        </Box>
        <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
          <Typography variant="subtitle1" component="h2" id={TITLE_ID} sx={{ fontWeight: 600 }}>
            {`${remaining} of ${total} required ${total === 1 ? 'step' : 'steps'} left to finish setting up ${subject}`}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {copy.detail}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={percent}
            aria-label={`${copy.landmark} progress`}
            sx={{ mt: 1.5, height: 6, borderRadius: 1 }}
          />
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0, ml: 'auto' }}>
          <Button component={RouterLink} to={copy.path} variant="contained" size="small">
            Continue
          </Button>
          <Button
            size="small"
            color="inherit"
            aria-label={copy.dismissLabel}
            onClick={() => {
              setDismissed(audience);
              void (audience === 'admin' ? dismissAdmin() : dismissChecklist());
            }}
          >
            Dismiss
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
