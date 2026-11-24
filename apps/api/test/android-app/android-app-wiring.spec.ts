// ShellKeep's Android companion wiring (#74): the identity every surface shares,
// the placeholder package id, the empty device source, and the edge include.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ANDROID_IDENTITY_SOURCE } from '@shellkeep/shared';
import { androidDeviceSourceRegistry } from '@marinoscar/platform-api/android-app';

import { ANDROID_IDENTITY } from '../../src/platform/android-app/android-app.config';
import { EMPTY_DEVICE_SOURCE } from '../../src/platform/android-app/empty-device-source';

const REPO = join(__dirname, '..', '..', '..', '..');

describe('the ShellKeep Android companion (#74)', () => {
  it('derives its identity from identity.json', () => {
    expect(ANDROID_IDENTITY_SOURCE.productName).toBe('ShellKeep');
    expect(ANDROID_IDENTITY.applicationId).toBe('com.example.shellkeep');
    expect(ANDROID_IDENTITY.apkStem).toBe('shellkeep');
  });

  it('registers the empty device source, so no paired device is reported', async () => {
    expect(androidDeviceSourceRegistry.has(EMPTY_DEVICE_SOURCE.id)).toBe(true);
    await expect(EMPTY_DEVICE_SOURCE.reportedApps()).resolves.toEqual([]);
  });

  it('includes the platform nginx snippet from an app-owned location file', () => {
    const file = join(REPO, 'infra', 'nginx', 'app.d', 'locations', 'android-app.conf');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toMatch(/^include \/etc\/nginx\/platform\/android-app\.conf;$/m);
    expect(existsSync(join(REPO, 'infra', 'nginx', 'platform', 'android-app.conf'))).toBe(true);
  });
});
