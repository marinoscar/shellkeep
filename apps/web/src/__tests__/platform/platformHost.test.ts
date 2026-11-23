import { describe, it, expect, vi, afterEach } from 'vitest';
import { hostApi, STORAGE_STATUS_PATH } from '../../platform/platformHost';
import { platformApi } from '../../services/api';

describe('hostApi (platform host transport)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('answers the storage status with configured: false until the storage slice (#50)', async () => {
    await expect(hostApi.get(STORAGE_STATUS_PATH)).resolves.toEqual({ configured: false });
  });

  it('forwards every other call to the app client', () => {
    expect(hostApi.patch).toBe(platformApi.patch);
    expect(hostApi.postFormData).toBe(platformApi.postFormData);
  });
});
