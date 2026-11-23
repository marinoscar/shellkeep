import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import App from '../App';

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
});
