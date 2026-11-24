import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import App from '../../App';
import { api } from '../../services/api';

/**
 * Issue #51: `/settings/notifications` is the packaged preferences matrix,
 * reached by any signed-in user (no permission), drawn from the events and
 * channels the API registers.
 */

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
          roles: [{ name: 'viewer' }],
          permissions: ['user_settings:read', 'user_settings:write'],
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

const channel = (id: string, label: string, order: number) => ({
  id,
  label,
  description: `${label} delivery.`,
  userConfigurable: true,
  criticalCapable: false,
  broadcastCapable: true,
  broadcastDefault: id === 'browser',
  order,
});

describe('notification preferences (#51)', () => {
  beforeEach(() => {
    api.setAccessToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    api.setAccessToken(null);
  });

  it('draws the reaped-session event for a viewer', async () => {
    signIn();
    const read: string[] = [];
    server.use(
      http.get('*/api/notifications/events', ({ request }) => {
        read.push(new URL(request.url).pathname);
        return HttpResponse.json({
          data: [
            {
              key: 'terminal.session_reaped',
              label: 'Terminal session closed after inactivity',
              description: 'A terminal session of yours was closed after it sat idle.',
              channels: ['browser', 'email', 'push'],
              declaredChannels: ['browser', 'email', 'push'],
              defaultEnabled: true,
              mandatory: false,
            },
          ],
        });
      }),
      http.get('*/api/notifications/channels', ({ request }) => {
        read.push(new URL(request.url).pathname);
        return HttpResponse.json({
          data: [channel('browser', 'In-app', 1), channel('email', 'Email', 2), channel('push', 'Push', 3)],
        });
      }),
    );

    render(
      <MemoryRouter initialEntries={['/settings/notifications']}>
        <App />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('Terminal session closed after inactivity', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(read).toEqual(
      expect.arrayContaining(['/api/notifications/events', '/api/notifications/channels']),
    );
  });
});
