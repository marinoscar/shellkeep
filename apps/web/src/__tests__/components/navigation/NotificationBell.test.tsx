import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import App from '../../../App';
import { api } from '../../../services/api';

/**
 * Issue #51: the packaged notification bell sits in the app bar, under the
 * root `NotificationProvider`, and shows the inbox the API serves.
 */

const PERMISSIONS = [
  'user_settings:read',
  'user_settings:write',
  'sessions:read',
  'servers:read',
];

function signIn() {
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
          roles: [{ name: 'contributor' }],
          permissions: PERMISSIONS,
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

const REAPED = {
  id: 'notif-1',
  eventKey: 'terminal.session_reaped',
  title: 'Your terminal session was closed after inactivity',
  body: 'Session "build" on server-a.example.test was idle for 2 hours.',
  link: '/sessions',
  readAt: null,
  createdAt: '2026-11-23T10:00:00.000Z',
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('NotificationBell in the app bar (#51)', () => {
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
  });

  it('shows the unread count and lists the inbox in its popover', async () => {
    signIn();
    server.use(
      http.get('*/api/notifications/unread-count', () =>
        HttpResponse.json({ data: { unreadCount: 1 } }),
      ),
      http.get('*/api/notifications', () =>
        HttpResponse.json({
          data: { items: [REAPED], total: 1, page: 1, pageSize: 20, totalPages: 1 },
        }),
      ),
    );
    renderAt('/');

    const bell = await screen.findByRole(
      'button',
      { name: 'Notifications, 1 unread' },
      { timeout: 5000 },
    );
    await userEvent.click(bell);

    const popover = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(
      within(popover).getByText('Your terminal session was closed after inactivity'),
    ).toBeInTheDocument();
  });

  it('says none unread for an empty inbox', async () => {
    signIn();
    renderAt('/');
    expect(
      await screen.findByRole('button', { name: 'Notifications, none unread' }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('renders no bell for a signed-out visitor', async () => {
    server.use(
      http.post('*/api/auth/refresh', () =>
        HttpResponse.json({ message: 'No session' }, { status: 401 }),
      ),
    );
    renderAt('/login');
    // The login page renders outside the layout: no app bar, no bell.
    await screen.findAllByRole('button', {}, { timeout: 5000 });
    expect(screen.queryByRole('button', { name: /^Notifications/ })).not.toBeInTheDocument();
  });
});
