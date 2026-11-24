import { Typography } from '@mui/material';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import { AndroidUpdateBanner } from '@marinoscar/platform-web/android-app/ui';
import { MaintenanceBanner } from '@marinoscar/platform-web/host/ui';
import { usePushSubscriptionSync } from '@marinoscar/platform-web/notifications/headless';
import {
  NotificationBell,
  NotificationPermissionBanner,
} from '@marinoscar/platform-web/notifications/ui';
import { OnboardingProvider } from '@marinoscar/platform-web/onboarding/headless';
import { GettingStartedMenuItem, WelcomeDialog } from '@marinoscar/platform-web/onboarding/ui';
import { ShellAppBar, ShellLayout, ShellUserMenu } from '@marinoscar/platform-web/shell/ui';
import type { ShellUserMenuItem } from '@marinoscar/platform-web/shell/ui';
import { ANDROID_TWA_KEY_PREFIX } from '../../config/androidApp';
import { APP_NAME, APP_VERSION } from '../../config/app';
import { SHELLKEEP_NAVIGATION } from '../../config/shell';
import { USER_HUB_PATH, USER_HUB_TITLE } from '../../config/userSettingsSections';
import { BrandLockup } from './BrandMark';
import { OnboardingBanner } from '../onboarding/OnboardingBanner';
import { adminWelcomePane, userWelcomePane } from '../onboarding/welcomePanes';

/**
 * The app shell (issue #76): a thin binding of the platform's `ShellLayout`
 * (`@marinoscar/platform-web/shell/ui`).
 *
 *   compact  (< sm)  : the bottom bar (a More sheet once destinations overflow it)
 *   medium   (sm-lg) : the collapsed rail, Console pinned at its foot
 *   expanded (>= lg) : the expanded rail; on any `/admin` route, Console mode
 *
 * The package owns the chrome and, with it, the FIVE COUPLED BREAKPOINT GATES
 * (the rail's `up('sm')` mount, the bottom bar's `down('sm')` self-gate,
 * `<main>`'s `pb: { xs: 10, sm: 3 }`, the settings hub's and the AppBar's
 * `isCompactWindow`). NOTHING IN THIS FILE READS A BREAKPOINT, and nothing here
 * may: `__tests__/config/breakpointGates.test.ts` fails the build if one appears.
 *
 * What this file contributes is the app's slots:
 *   - the navigation (`config/shell.ts`) and the brand;
 *   - the AppBar's `actions`: the notification bell (#51), in both treatments,
 *     where on a compact settings screen it is the only way into the centre;
 *   - the user menu: the destinations, the onboarding slice's "Getting started"
 *     row, a Settings row (Settings is reached from here, not from the rail)
 *     and a version line in its footer;
 *   - the `banners` above the page, each rendering nothing on an ordinary day;
 *   - the `overlays`: the onboarding slice's one-time welcome dialog (#70),
 *     with ShellKeep's panes.
 *
 * ONBOARDING (#70): one `OnboardingProvider` around the WHOLE shell, so the
 * routed pages (`/settings/getting-started`, `/admin/settings/setup`), the
 * banner, the menu row and the welcome read one `GET /api/onboarding`. Here,
 * not in `App.tsx`: every call it makes is authenticated, and the shell exists
 * exactly for a signed-in user.
 */
export function Layout() {
  // #51: mounted HERE, once, and not inside the banners: a full-bleed page
  // drops the banners, and the subscription must stay registered on every
  // page. The shell exists exactly for a signed-in user; this keeps this
  // device's Web Push subscription registered on every load when push is
  // configured, and feeds the permission banner.
  const pushSync = usePushSubscriptionSync();

  return (
    <OnboardingProvider appName={APP_NAME}>
      <ShellLayout
        navigation={SHELLKEEP_NAVIGATION}
        brand={<BrandLockup name={APP_NAME} />}
        appBar={
          <ShellAppBar
            navigation={SHELLKEEP_NAVIGATION}
            brand={<BrandLockup name={APP_NAME} />}
            actions={<NotificationBell />}
            userMenu={
              <ShellUserMenu
                navigation={SHELLKEEP_NAVIGATION}
                // #70: clears the stored welcome and dismissals so the dialog and
                // the checklists return. Renders nothing before the state loads.
                items={(close) => <GettingStartedMenuItem onDone={close} />}
                extraItems={USER_MENU_ITEMS}
                footer={<VersionLine />}
              />
            }
          />
        }
        banners={<ShellBanners pushSync={pushSync} />}
        // #70: portalled, so its place here is about lifetime, not layout. It
        // opens while `onboarding.welcomeSeenAt` is unset; every way out sets it.
        overlays={<WelcomeDialog slots={{ userPane: userWelcomePane, adminPane: adminWelcomePane }} />}
      />
    </OnboardingProvider>
  );
}

/** The user menu's own rows, after the destinations and above sign-out. */
const USER_MENU_ITEMS: ShellUserMenuItem[] = [
  {
    key: 'settings',
    label: USER_HUB_TITLE,
    icon: <SettingsOutlinedIcon fontSize="small" />,
    to: USER_HUB_PATH,
  },
];

/** The footer of the user menu: a label, not an action. */
function VersionLine() {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      component="div"
      sx={{ px: 2, py: 1 }}
      onClick={(event) => event.stopPropagation()}
    >
      {APP_NAME} {APP_VERSION}
    </Typography>
  );
}

/**
 * Above the page, because each is a property of the shell rather than of the
 * page being looked at. A full-bleed page (`useShellMainVariant`) draws none.
 */
function ShellBanners({ pushSync }: { pushSync: ReturnType<typeof usePushSubscriptionSync> }) {
  return (
    <>
      {/* An open maintenance window, for an administrator it lets through
          (#46). Renders nothing for everyone else. */}
      <MaintenanceBanner />
      {/* Only inside the Android app's Trusted Web Activity, and only when the
          installed build is older than the hosted release (#74). */}
      <AndroidUpdateBanner keyPrefix={ANDROID_TWA_KEY_PREFIX} />
      {/* What is left to set up (#70): the deployment's required steps for an
          administrator, else the account's. Renders nothing once they are
          done, once dismissed, and on the checklist page itself. */}
      <OnboardingBanner />
      {/* Renders nothing unless this device still needs to allow (or
          unblock, or install for) notifications (#51). */}
      <NotificationPermissionBanner
        config={pushSync.config}
        capability={pushSync.capability}
        onRequestPermission={() => void pushSync.requestPermission()}
        isRequestingPermission={pushSync.isRequestingPermission}
      />
    </>
  );
}
