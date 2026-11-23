import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { clearMaintenanceBlock } from '@marinoscar/platform-web/host/headless';
import { server } from '../mocks/server';
import App from '../../App';
import { api } from '../../services/api';

/**
 * Issue #46: the admin hub and its pages are gated on the permissions the API
 * enforces, and a maintenance 503 swaps the application for the packaged
 * maintenance screen.
 */

const CONTRIBUTOR = [
  'user_settings:read',
  'user_settings:write',
  'sessions:read',
  'servers:read',
  'sessions:write',
  'servers:write',
];
const ADMIN = [...CONTRIBUTOR, 'users:read', 'allowlist:read', 'system_settings:read', 'system_settings:write'];

function signIn(permissions: string[], roles: string[]) {
  server.use(
    http.post('*/api/auth/refresh', () =>
      HttpResponse.json({ data: { accessToken: 'header.payload.sig', expiresIn: 900 } }),
    ),
    http.get('*/api/auth/me', () =>
      HttpResponse.json({
        data: {
          id: 'user-a',
          email: 'person-a@example.test',
          displayName: 'Person A',
          profileImageUrl: null,
          roles: roles.map((name) => ({ name })),
          permissions,
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          tenancyMode: 'single',
          activeOrg: { id: 'org-1', name: 'Org Alpha', slug: 'org-alpha' },
          memberships: [],
        },
      }),
    ),
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('admin settings routing (#46)', () => {
  beforeEach(() => {
    api.setAccessToken(null);
    vi.stubGlobal(
      'WebSocket',
      class {
        send() {}
        close() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    api.setAccessToken(null);
    clearMaintenanceBlock();
  });

  it('shows an administrator the admin hub', async () => {
    signIn(ADMIN, ['admin']);
    renderAt('/admin/settings');
    expect(await screen.findByRole('heading', { name: 'System Settings' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Doctor')).toBeInTheDocument();
    expect(screen.getByText('Maintenance')).toBeInTheDocument();
  });

  it('sends a contributor away from the admin hub and its pages', async () => {
    signIn(CONTRIBUTOR, ['contributor']);
    for (const path of ['/admin/settings', '/admin/settings/doctor', '/admin/settings/terminal']) {
      const { unmount } = renderAt(path);
      expect(await screen.findByText(/ShellKeep Control Center/i, {}, { timeout: 5000 })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'System Settings' })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('replaces the application with the maintenance screen on a maintenance 503', async () => {
    signIn(CONTRIBUTOR, ['contributor']);
    server.use(
      http.get('*/api/sessions', () =>
        HttpResponse.json(
          {
            statusCode: 503,
            message: 'Planned work in progress.',
            details: { reason: 'MAINTENANCE_MODE', retryAfterSeconds: 30, allowAdmins: true },
          },
          { status: 503 },
        ),
      ),
    );
    renderAt('/sessions');
    expect(await screen.findByText('Planned work in progress.', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sessions' })).not.toBeInTheDocument();
  });
});
