import { registerAndroidDeviceSource, type AndroidDeviceSource } from '@marinoscar/platform-api/android-app';

/**
 * ShellKeep's device source (#74): the Android app is a Trusted Web Activity
 * with no native capability, so no paired device reports anything and the
 * Android admin page's "reported apps" list is empty. A future native module
 * registers a source of its own.
 */
export const EMPTY_DEVICE_SOURCE: AndroidDeviceSource = {
  id: 'shellkeep-twa',
  reportedApps: async () => [],
};

/** Registers {@link EMPTY_DEVICE_SOURCE} once. */
export function registerEmptyDeviceSource(): void {
  registerAndroidDeviceSource(EMPTY_DEVICE_SOURCE);
}
