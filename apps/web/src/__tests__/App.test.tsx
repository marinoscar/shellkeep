import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import App from '../App';

/**
 * The packaged About page is replaced with an UNGUARDED stand-in with its own
 * heading, so the About route-gate tests below are about `App.tsx`'s wiring:
 * anything that renders the stand-in reached the route, and any redirect came
 * from the route's `RequirePermission`, not from the page.
 */
vi.mock('@marinoscar/platform-web/host/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@marinoscar/platform-web/host/ui')>()),
  AboutPage: () => <h1>Admin About</h1>,
}));

/** Overrides `GET /auth/me` for one test, so the route tree sees this user. */
function signInAs(permissions: string[], roles: string[] = ['viewer']) {
  server.use(
    http.get('*/api/auth/me', () =>
      HttpResponse.json({
        data: {
          id: 'test-user-id',
          email: 'test@example.com',
          displayName: 'Test User',
          profileImageUrl: null,
          roles: roles.map((name) => ({ name })),
          permissions,
          isActive: true,
          createdAt: new Date().toISOString(),
        },
      }),
    ),
  );
}

describe('App', () => {
  beforeEach(() => {
    // The signed-in home page fetches sessions and server profiles on mount;
    // answer them so those loads settle inside the test.
    server.use(
      http.get('*/api/sessions', () =>
        HttpResponse.json({ items: [], total: 1, page: 1, pageSize: 20 }),
      ),
      http.get('*/api/server-profiles', () =>
        HttpResponse.json({ items: [], total: 1, page: 1, pageSize: 20 }),
      ),
    );
  });

  it('renders without crashing and shows login page initially', async () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );

    // Wait for lazy loaded component to render
    // The App will make an API call to check auth, MSW will handle it
    await waitFor(
      () => {
        // Should either show login page or home page depending on mock auth state
        const welcomeText = screen.queryByText(/Welcome/i);
        const homeText = screen.queryByText(/Home Page/i);
        expect(welcomeText || homeText).toBeTruthy();
      },
      { timeout: 5000 }
    );

    // If the home page rendered, let its panels finish loading before the
    // test ends: a setState after the jsdom teardown fails the run with
    // "window is not defined".
    if (screen.queryByText(/ShellKeep Control Center/i)) {
      await waitFor(() => {
        expect(screen.getByText('1 active session')).toBeInTheDocument();
        expect(screen.getByText('1 detached')).toBeInTheDocument();
        expect(screen.getByText('1 server')).toBeInTheDocument();
        expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
      });
    }
  });

  describe('the About route gate (#147)', () => {
    it('lets a user holding system_settings:read reach /admin/settings/about', async () => {
      signInAs(['user_settings:read', 'system_settings:read'], ['admin']);

      render(
        <MemoryRouter initialEntries={['/admin/settings/about']}>
          <App />
        </MemoryRouter>,
      );

      await waitFor(
        () => expect(screen.getByRole('heading', { name: 'Admin About' })).toBeInTheDocument(),
        { timeout: 5000 },
      );
    });

    it('gates on the permission, not the admin role', async () => {
      signInAs(['user_settings:read', 'system_settings:read'], ['contributor']);

      render(
        <MemoryRouter initialEntries={['/admin/settings/about']}>
          <App />
        </MemoryRouter>,
      );

      await waitFor(
        () => expect(screen.getByRole('heading', { name: 'Admin About' })).toBeInTheDocument(),
        { timeout: 5000 },
      );
    });

    it('sends a user without system_settings:read home instead', async () => {
      // `users:read` admits them to the Console hub, but not to About.
      signInAs(['user_settings:read', 'users:read']);

      render(
        <MemoryRouter initialEntries={['/admin/settings/about']}>
          <App />
        </MemoryRouter>,
      );

      await waitFor(() => expect(screen.getByText(/welcome back/i)).toBeInTheDocument(), {
        timeout: 5000,
      });
      expect(screen.queryByRole('heading', { name: 'Admin About' })).not.toBeInTheDocument();
      // Let the home page's panels settle before teardown.
      await waitFor(() => expect(screen.queryAllByRole('progressbar')).toHaveLength(0));
    });
  });
});
