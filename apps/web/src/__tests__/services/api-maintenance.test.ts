import { describe, it, expect, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import {
  clearMaintenanceBlock,
  getMaintenanceBlock,
} from '@marinoscar/platform-web/host/headless';
import { server } from '../mocks/server';
import { api, ApiError } from '../../services/api';

/**
 * The HTTP client feeds the host slice's maintenance block store (#46): a 503
 * carrying `details.reason: 'MAINTENANCE_MODE'` is recorded for the packaged
 * `MaintenanceGate`; any other error, an ordinary 503 included, is not. The
 * error is thrown either way.
 */
describe('api maintenance interception (#46)', () => {
  afterEach(() => {
    clearMaintenanceBlock();
  });

  it('records a maintenance 503 and still throws', async () => {
    server.use(
      http.get('*/api/servers-probe', () =>
        HttpResponse.json(
          {
            statusCode: 503,
            code: 'SERVICE_UNAVAILABLE',
            message: 'Planned work until noon.',
            details: { reason: 'MAINTENANCE_MODE', retryAfterSeconds: 45, allowAdmins: true },
          },
          { status: 503 },
        ),
      ),
    );

    await expect(api.get('/servers-probe')).rejects.toBeInstanceOf(ApiError);
    expect(getMaintenanceBlock()).toEqual({
      message: 'Planned work until noon.',
      retryAfterSeconds: 45,
      allowAdmins: true,
    });
  });

  it('ignores a 503 without the marker', async () => {
    server.use(
      http.get('*/api/servers-probe', () =>
        HttpResponse.json({ statusCode: 503, message: 'Upstream down' }, { status: 503 }),
      ),
    );

    await expect(api.get('/servers-probe')).rejects.toBeInstanceOf(ApiError);
    expect(getMaintenanceBlock()).toBeNull();
  });
});
