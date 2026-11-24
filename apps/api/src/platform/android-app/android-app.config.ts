import { ANDROID_IDENTITY_SOURCE, APP_NAME } from '@shellkeep/shared';
import { AndroidAppModule, androidDeviceSourceRegistry } from '@marinoscar/platform-api/android-app';
import { androidIdentity } from '@marinoscar/platform-contract/android-app';

import { EMPTY_DEVICE_SOURCE, registerEmptyDeviceSource } from './empty-device-source';

// =============================================================================
// ShellKeep's Android companion (#74)
// =============================================================================
//
// A Trusted Web Activity around the PWA (`apps/android`). This file is the
// server half: the trusted apps and the public `assetlinks.json`, the hosted
// APK releases, the signed download links and the Android test notification.
//
// The manifest half runs at import, before any module composes: the device
// source (empty, since the shell has no native capability). The `android_app`
// channel is declared by `app-registrations/notifications.ts` and the
// `android-releases/` prefix by `platform/storage/storage-key-prefix.manifest.ts`.
// =============================================================================

if (!androidDeviceSourceRegistry.has(EMPTY_DEVICE_SOURCE.id)) registerEmptyDeviceSource();

/** The Android identity every surface shares (identity.json, plus its optional `android` block). */
export const ANDROID_IDENTITY = androidIdentity(ANDROID_IDENTITY_SOURCE);

/** The slice, mounted once in AppModule. */
export const androidAppModule = AndroidAppModule.forRoot({
  appName: APP_NAME,
  apkStem: ANDROID_IDENTITY.apkStem,
  testNotificationLink: '/sessions',
});
