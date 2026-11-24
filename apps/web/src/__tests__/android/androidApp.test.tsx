// ShellKeep's Android companion wiring (#74): the identity every surface
// shares, the client an app component would call, the release hook, and the
// admin card's permission and route.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ANDROID_IDENTITY_SOURCE } from '@shellkeep/shared';
import { PlatformHostProvider } from '@marinoscar/platform-web/core';
import { createTestPlatformHost } from '@marinoscar/platform-web/testing';
import {
  androidIdentity,
  createAndroidAppClient,
  useAndroidRelease,
} from '@marinoscar/platform-web/android-app/headless';
import { androidAppSettingsPage } from '@marinoscar/platform-web/android-app/ui';

import { ADMIN_SECTIONS } from '../../config/adminSections';
import { ANDROID_IDENTITY, ANDROID_TWA_KEY_PREFIX } from '../../config/androidApp';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', '..');

const RELEASE = {
  id: '00000000-0000-4000-8000-000000000001',
  packageName: ANDROID_IDENTITY.applicationId,
  versionName: '1.0.0',
  versionCode: 1,
  fileSha256: 'a'.repeat(64),
  sizeBytes: '1024',
  notes: null,
  createdAt: '2026-10-08T00:00:00.000Z',
};

describe('the ShellKeep Android companion (#74)', () => {
  it('derives the identity from identity.json, with the storage prefix as the TWA key prefix', () => {
    expect(ANDROID_IDENTITY).toEqual(androidIdentity(ANDROID_IDENTITY_SOURCE));
    expect(ANDROID_IDENTITY.applicationId).toBe('com.example.shellkeep');
    expect(ANDROID_IDENTITY.apkStem).toBe('shellkeep');
    expect(ANDROID_TWA_KEY_PREFIX).toBe(ANDROID_IDENTITY.storagePrefix);
  });

  it('calls the API through createAndroidAppClient', async () => {
    const host = createTestPlatformHost({
      responses: {
        [`POST /android-app/releases/${RELEASE.id}/download-link`]: {
          url: '/api/android-app/download/t',
          expiresAt: '2026-10-08T00:10:00.000Z',
        },
      },
    });
    const client = createAndroidAppClient(host.api);
    expect((await client.downloadLink(RELEASE.id)).url).toBe('/api/android-app/download/t');
  });

  it('reads the current release with useAndroidRelease, and nothing when disabled', async () => {
    const host = createTestPlatformHost({ responses: { 'GET /android-app/releases/latest': RELEASE } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlatformHostProvider host={host}>{children}</PlatformHostProvider>
    );
    const { result } = renderHook(() => useAndroidRelease(true), { wrapper });
    await waitFor(() => expect(result.current.release?.versionCode).toBe(1));
    const before = host.requests.length;
    renderHook(() => useAndroidRelease(false), { wrapper });
    expect(host.requests.length).toBe(before);
  });

  it('declares the Android app card with system_settings:read, appended to General', () => {
    const general = ADMIN_SECTIONS.find((s) => s.label === 'General');
    const card = general?.cards.find((c) => c.path === androidAppSettingsPage.card.path);
    expect(card?.permission).toBe('system_settings:read');
    expect(card?.path).toBe('/admin/settings/android');
    expect(card && 'feature' in card ? card.feature : undefined).toBeUndefined();
    // Appended, not inserted: cards appended later (such as the Setup guide) follow it,
    // so it is never required to be last; it must come after the cards that preceded it.
    const paths = general?.cards.map((c) => c.path) ?? [];
    const index = paths.indexOf('/admin/settings/android');
    expect(index).toBeGreaterThan(0);
    expect(paths.indexOf('/admin/settings/setup')).toBeGreaterThan(index);
  });

  it('routes the card behind the same permission, and captures the TWA launch before render', () => {
    const app = readFileSync(resolve(SRC, 'App.tsx'), 'utf8');
    expect(app).toMatch(/path="\/admin\/settings\/android"[\s\S]{0,200}permission="system_settings:read"/);
    const main = readFileSync(resolve(SRC, 'main.tsx'), 'utf8');
    expect(main.indexOf('captureTwaLaunch(')).toBeGreaterThan(-1);
    expect(main.indexOf('captureTwaLaunch(')).toBeLessThan(main.indexOf('ReactDOM.createRoot'));
    const layout = readFileSync(resolve(SRC, 'components/common/Layout.tsx'), 'utf8');
    expect(layout).toContain('<AndroidUpdateBanner keyPrefix={ANDROID_TWA_KEY_PREFIX} />');
  });
});
