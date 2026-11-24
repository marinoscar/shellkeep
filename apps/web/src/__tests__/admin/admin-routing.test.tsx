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
  // Object access (#50): every role holds it; it does not open the Storage page.
  'storage:read',
  'storage:write',
  'user_settings:read',
  'user_settings:write',
  'sessions:read',
  'servers:read',
  'sessions:write',
  'servers:write',
];
const ADMIN = [
  ...CONTRIBUTOR,
  'users:read',
  'allowlist:read',
  'system_settings:read',
  'system_settings:write',
  'jobs:read',
  'jobs:write',
  'nodes:read',
  'nodes:write',
  'storage_config:read',
  'storage_config:write',
  // #51.
  'push:read',
  'push:write',
  'broadcasts:read',
  'broadcasts:write',
];

/** `GET /api/admin/storage-config` before anything is configured: S3 only, nothing stored. */
const UNCONFIGURED_STORAGE = {
  provider: 's3',
  drivers: { s3: { bucket: '', region: '', endpoint: '', accessKeyId: '', forcePathStyle: null } },
  descriptors: [
    {
      kind: 'storage-driver',
      id: 's3',
      label: 'Amazon S3',
      description: 'AWS S3.',
      fields: [
        { kind: 'string', name: 'bucket', label: 'Bucket', maxLength: 255 },
        { kind: 'string', name: 'region', label: 'Region', maxLength: 255 },
        { kind: 'string', name: 'endpoint', label: 'Endpoint', maxLength: 512 },
        { kind: 'string', name: 'accessKeyId', label: 'Access key ID', maxLength: 255 },
        { kind: 'boolean', name: 'forcePathStyle', label: 'Force path style' },
        { kind: 'secret', name: 'secretAccessKey', label: 'Secret access key', hasValue: false, required: true },
      ],
    },
  ],
  bucket: '',
  region: '',
  endpoint: '',
  accountId: '',
  accessKeyId: '',
  forcePathStyle: null,
  effectiveEndpoint: null,
  configured: false,
  missing: ['bucket', 'region', 'accessKeyId', 'secretAccessKey'],
  secretStatus: { configured: false, hint: null, updatedAt: null, updatedByUserId: null },
  version: 0,
  updatedAt: null,
  updatedBy: null,
};

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
    expect(await screen.findByRole('heading', { name: 'Console' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Doctor')).toBeInTheDocument();
    expect(screen.getByText('Maintenance')).toBeInTheDocument();
    // #49: the Operations cards.
    expect(screen.getByText('Jobs')).toBeInTheDocument();
    expect(screen.getByText('Job Insights')).toBeInTheDocument();
    expect(screen.getByText('Worker Nodes')).toBeInTheDocument();
    // #50: the Storage card.
    expect(screen.getByText('Storage')).toBeInTheDocument();
    // #51: the Email, Web Push and Broadcasts cards.
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Web Push')).toBeInTheDocument();
    expect(screen.getByText('Broadcasts')).toBeInTheDocument();
  });

  it('opens the packaged Email page for an administrator (#51)', async () => {
    signIn(ADMIN, ['admin']);
    const read: string[] = [];
    server.use(
      http.get('*/api/email-settings', ({ request }) => {
        read.push(new URL(request.url).pathname);
        return HttpResponse.json({ message: 'Not configured' }, { status: 500 });
      }),
    );
    renderAt('/admin/settings/email');
    expect(await screen.findByRole('heading', { name: 'Email' }, { timeout: 5000 })).toBeInTheDocument();
    await vi.waitFor(() => expect(read).toContain('/api/email-settings'), { timeout: 5000 });
  });

  it('opens the packaged Web Push page for an administrator (#51)', async () => {
    signIn(ADMIN, ['admin']);
    const read: string[] = [];
    server.use(
      http.get('*/api/admin/push-config', ({ request }) => {
        read.push(new URL(request.url).pathname);
        return HttpResponse.json({ message: 'Not configured' }, { status: 500 });
      }),
    );
    renderAt('/admin/settings/push');
    expect(await screen.findByRole('heading', { name: 'Web Push' }, { timeout: 5000 })).toBeInTheDocument();
    await vi.waitFor(() => expect(read).toContain('/api/admin/push-config'), { timeout: 5000 });
  });

  it('opens the packaged Broadcasts page for an administrator (#51)', async () => {
    signIn(ADMIN, ['admin']);
    const listed: string[] = [];
    server.use(
      http.get('*/api/admin/broadcasts', ({ request }) => {
        listed.push(new URL(request.url).pathname);
        return HttpResponse.json({
          data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
        });
      }),
    );
    renderAt('/admin/settings/broadcasts');
    expect(await screen.findByRole('heading', { name: 'Broadcasts' }, { timeout: 5000 })).toBeInTheDocument();
    await vi.waitFor(() => expect(listed).toContain('/api/admin/broadcasts'), { timeout: 5000 });
  });

  it('opens Broadcasts for an organization administrator holding only org_broadcasts:read (#51)', async () => {
    signIn([...CONTRIBUTOR, 'org_broadcasts:read'], ['contributor', 'org_admin']);
    server.use(
      http.get('*/api/admin/broadcasts', () =>
        HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 } }),
      ),
    );
    renderAt('/admin/settings');
    expect(await screen.findByRole('heading', { name: 'Console' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Broadcasts')).toBeInTheDocument();
    expect(screen.queryByText('Web Push')).not.toBeInTheDocument();
    expect(screen.queryByText('Email')).not.toBeInTheDocument();
  });

  it('opens the packaged Storage page for an administrator (#50)', async () => {
    signIn(ADMIN, ['admin']);
    const read: string[] = [];
    server.use(
      http.get('*/api/admin/storage-config', ({ request }) => {
        read.push(new URL(request.url).pathname);
        return HttpResponse.json({ data: UNCONFIGURED_STORAGE });
      }),
      http.get('*/api/admin/storage/migrations', () =>
        HttpResponse.json({
          data: { items: [], meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } },
        }),
      ),
    );
    renderAt('/admin/settings/storage');
    expect(await screen.findByRole('heading', { name: 'Storage' }, { timeout: 5000 })).toBeInTheDocument();
    await vi.waitFor(() => expect(read).toContain('/api/admin/storage-config'), { timeout: 5000 });
  });

  it('opens the packaged Jobs page for an administrator (#49)', async () => {
    signIn(ADMIN, ['admin']);
    const listed: string[] = [];
    server.use(
      http.get('*/api/admin/jobs', ({ request }) => {
        listed.push(new URL(request.url).pathname);
        return HttpResponse.json({
          data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
        });
      }),
    );
    renderAt('/admin/settings/jobs');
    expect(await screen.findByRole('heading', { name: 'Jobs' }, { timeout: 5000 })).toBeInTheDocument();
    await vi.waitFor(() => expect(listed).toContain('/api/admin/jobs'), { timeout: 5000 });
  });

  it('opens the packaged Worker Nodes page for an administrator (#49)', async () => {
    signIn(ADMIN, ['admin']);
    const listed: string[] = [];
    server.use(
      http.get('*/api/admin/nodes', ({ request }) => {
        listed.push(new URL(request.url).pathname);
        return HttpResponse.json({ data: [] });
      }),
      http.get('*/api/admin/nodes/credentials', () => HttpResponse.json({ data: [] })),
    );
    renderAt('/admin/settings/workers');
    expect(
      await screen.findByRole('heading', { name: 'Worker Nodes' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    await vi.waitFor(() => expect(listed).toContain('/api/admin/nodes'), { timeout: 5000 });
  });

  it('sends a contributor away from the admin hub and its pages', async () => {
    signIn(CONTRIBUTOR, ['contributor']);
    for (const path of [
      '/admin/settings',
      '/admin/settings/doctor',
      '/admin/settings/terminal',
      '/admin/settings/storage',
      '/admin/settings/jobs',
      '/admin/settings/jobs/insights',
      '/admin/settings/workers',
      '/admin/settings/email',
      '/admin/settings/push',
      '/admin/settings/broadcasts',
    ]) {
      const { unmount } = renderAt(path);
      expect(await screen.findByText(/ShellKeep Control Center/i, {}, { timeout: 5000 })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Console' })).not.toBeInTheDocument();
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
