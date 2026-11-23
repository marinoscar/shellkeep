import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import App from '../../App';
import { api } from '../../services/api';

/**
 * Issue #47: the app runs on the identity slice's AuthProvider, guards and
 * pages. Routes are gated on the permission strings the API enforces, never on
 * a role name, and a viewer never gets a terminal socket.
 */

const VIEWER = ['user_settings:read', 'user_settings:write', 'sessions:read', 'servers:read'];
const CONTRIBUTOR = [...VIEWER, 'sessions:write', 'servers:write', 'sessions:delete', 'servers:delete'];
const ADMIN = [...CONTRIBUTOR, 'users:read', 'users:write', 'allowlist:read', 'allowlist:write', 'system_settings:read'];

function signIn(permissions: string[] | null, roles: string[] = ['viewer']) {
  server.use(
    http.post('*/api/auth/refresh', () =>
      permissions
        ? HttpResponse.json({ data: { accessToken: 'header.payload.sig', expiresIn: 900 } })
        : HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
    ),
    http.get('*/api/auth/me', () =>
      HttpResponse.json({
        data: {
          id: 'user-a',
          email: 'person-a@example.test',
          displayName: 'Person A',
          profileImageUrl: null,
          roles: roles.map((name) => ({ name })),
          permissions: permissions ?? [],
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

const sockets = vi.fn();

describe('identity routing (#47)', () => {
  beforeEach(() => {
    api.setAccessToken(null);
    sockets.mockClear();
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor(url: string) {
          sockets(url);
        }
        send() {}
        close() {}
      },
    );
    server.use(
      http.get('*/api/sessions', () => HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 })),
      http.get('*/api/sessions/:id', () =>
        HttpResponse.json({
          data: {
            id: 's-1',
            name: 'session-a',
            status: 'active',
            serverProfile: { id: 'p-1', name: 'server-a', hostname: 'server-a.example.test', username: 'person-a', color: 'default' },
          },
        }),
      ),
      http.get('*/api/server-profiles', () => HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 })),
      http.get('*/api/users', () => HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 10, totalPages: 0 } })),
      http.get('*/api/roles', () => HttpResponse.json({ data: [] })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    api.setAccessToken(null);
  });

  it('sends a signed-out visitor to the branded packaged login page', async () => {
    signIn(null);
    renderAt('/sessions');
    expect(await screen.findByTestId('login-logo', {}, { timeout: 5000 })).toHaveTextContent('ShellKeep');
    expect(screen.getByText('Welcome')).toBeInTheDocument();
  });

  it('shows a viewer the read-only message and opens no terminal socket', async () => {
    signIn(VIEWER);
    renderAt('/sessions/s-1/terminal');
    expect(await screen.findByTestId('terminal-read-only', {}, { timeout: 5000 })).toHaveTextContent(
      /cannot open a terminal/i,
    );
    expect(sockets).not.toHaveBeenCalled();
  });

  it('shows a viewer the read-only message on the full-screen terminal too', async () => {
    signIn(VIEWER);
    renderAt('/terminal/s-1');
    expect(await screen.findByTestId('terminal-read-only', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(sockets).not.toHaveBeenCalled();
  });

  it('lets a contributor reach the terminal page', async () => {
    signIn(CONTRIBUTOR, ['contributor']);
    renderAt('/sessions/s-1/terminal');
    await waitFor(() => expect(screen.queryByTestId('login-logo')).not.toBeInTheDocument(), { timeout: 5000 });
    await waitFor(() => expect(screen.getAllByText('session-a').length).toBeGreaterThan(0), { timeout: 5000 });
    expect(screen.queryByTestId('terminal-read-only')).not.toBeInTheDocument();
  });

  it('serves the packaged Users & Allowlist page to a holder of users:read', async () => {
    signIn(ADMIN, ['admin', 'org_admin']);
    renderAt('/admin/users');
    expect(await screen.findByText('Users & Allowlist', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('sends a viewer away from /admin/users', async () => {
    signIn(VIEWER);
    renderAt('/admin/users');
    expect(await screen.findByText(/ShellKeep Control Center/i, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText('Users & Allowlist')).not.toBeInTheDocument();
  });

  it('renders the packaged sign-in error screen on /auth/error', async () => {
    signIn(null);
    renderAt('/auth/error?error=not_allowlisted');
    expect(await screen.findByText("You don't have access yet", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(/approved to use ShellKeep/)).toBeInTheDocument();
  });
});
