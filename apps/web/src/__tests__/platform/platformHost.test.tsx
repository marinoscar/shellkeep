import { describe, it, expect } from 'vitest';
import { usePlatformApi } from '@marinoscar/platform-web/core';
import { renderWithProviders, screen } from '../utils/test-utils';
import { platformApi } from '../../services/api';

let seen: unknown = null;

function ReadHostApi() {
  seen = usePlatformApi();
  return <span>host read</span>;
}

describe('AppPlatformHostProvider (platform host transport)', () => {
  it('hands the packaged pages the app client unchanged, with no storage-status shim (#50)', async () => {
    renderWithProviders(<ReadHostApi />);
    expect(await screen.findByText('host read')).toBeInTheDocument();
    expect(seen).toBe(platformApi);
    // The packaged profile page uploads through the host's multipart POST.
    expect(typeof platformApi.postFormData).toBe('function');
  });
});
