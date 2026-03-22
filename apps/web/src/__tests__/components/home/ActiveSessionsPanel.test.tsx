import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { render } from '../../utils/test-utils';
import { ActiveSessionsPanel } from '../../../components/home/ActiveSessionsPanel';
import type { TerminalSession } from '../../../types';

const API_BASE = '*/api';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function makeSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 'session-1',
    name: 'My Session',
    status: 'active',
    tmuxSessionId: 'tmux-1',
    cols: 220,
    rows: 50,
    lastActivityAt: new Date(Date.now() - 2 * 60000).toISOString(), // 2 min ago
    terminatedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    serverProfile: {
      id: 'sp-1',
      name: 'My Server',
      hostname: 'server.example.com',
      port: 22,
      username: 'alice',
    },
    ...overrides,
  };
}

describe('ActiveSessionsPanel', () => {
  beforeEach(() => {
    server.resetHandlers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Rendering', () => {
    it('should render the panel heading', async () => {
      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 6 }),
        ),
      );

      render(<ActiveSessionsPanel />);

      expect(screen.getByText(/active sessions/i)).toBeInTheDocument();
    });

    it('should render the View All button', async () => {
      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 6 }),
        ),
      );

      render(<ActiveSessionsPanel />);

      expect(screen.getByRole('button', { name: /view all/i })).toBeInTheDocument();
    });

    it('should show loading spinner initially', () => {
      server.use(
        http.get(`${API_BASE}/sessions`, async () => {
          await new Promise(() => {}); // never resolves
          return HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 6 });
        }),
      );

      render(<ActiveSessionsPanel />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty state message when there are no sessions', async () => {
      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 6 }),
        ),
      );

      render(<ActiveSessionsPanel />);

      await waitFor(() => {
        expect(screen.getByText(/no active sessions/i)).toBeInTheDocument();
      });
    });

    it('should show hint to start a session from saved servers', async () => {
      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 6 }),
        ),
      );

      render(<ActiveSessionsPanel />);

      await waitFor(() => {
        expect(
          screen.getByText(/start one from your saved servers/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe('Session List', () => {
    it('should render session names', async () => {
      const session = makeSession({ name: 'Prod Server', status: 'active' });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 6 }),
        ),
      );

      render(<ActiveSessionsPanel />);

      await waitFor(() => {
        expect(screen.getByText('Prod Server')).toBeInTheDocument();
      });
    });

    it('should render username@hostname for each session', async () => {
      const session = makeSession();

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 6 }),
        ),
      );

      render(<ActiveSessionsPanel />);

      await waitFor(() => {
        expect(
          screen.getByText(/alice@server\.example\.com/i),
        ).toBeInTheDocument();
      });
    });

    it('should render status chip for active sessions', async () => {
      const session = makeSession({ status: 'active' });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 6 }),
        ),
      );

      render(<ActiveSessionsPanel />);

      await waitFor(() => {
        expect(screen.getByText('active')).toBeInTheDocument();
      });
    });

    it('should render status chip for detached sessions', async () => {
      const session = makeSession({ id: 'session-2', status: 'detached' });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 6 }),
        ),
      );

      render(<ActiveSessionsPanel />);

      await waitFor(() => {
        expect(screen.getByText('detached')).toBeInTheDocument();
      });
    });

    it('should render Open button for each session', async () => {
      const session = makeSession();

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 6 }),
        ),
      );

      render(<ActiveSessionsPanel />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /open/i })).toBeInTheDocument();
      });
    });

    it('should combine active and detached sessions up to 6', async () => {
      const activeSessions = [
        makeSession({ id: 'a1', name: 'Active 1', status: 'active' }),
        makeSession({ id: 'a2', name: 'Active 2', status: 'active' }),
      ];
      const detachedSessions = [
        makeSession({ id: 'd1', name: 'Detached 1', status: 'detached' }),
      ];

      server.use(
        http.get(`${API_BASE}/sessions`, ({ request }) => {
          const url = new URL(request.url);
          const status = url.searchParams.get('status');
          if (status === 'active') {
            return HttpResponse.json({
              items: activeSessions,
              total: 2,
              page: 1,
              pageSize: 6,
            });
          }
          return HttpResponse.json({
            items: detachedSessions,
            total: 1,
            page: 1,
            pageSize: 6,
          });
        }),
      );

      render(<ActiveSessionsPanel />);

      await waitFor(() => {
        expect(screen.getByText('Active 1')).toBeInTheDocument();
        expect(screen.getByText('Active 2')).toBeInTheDocument();
        expect(screen.getByText('Detached 1')).toBeInTheDocument();
      });
    });
  });

  describe('Navigation', () => {
    it('should navigate to /sessions when View All is clicked', async () => {
      const user = userEvent.setup({ delay: null });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 6 }),
        ),
      );

      render(<ActiveSessionsPanel />);

      await waitFor(() =>
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(),
      );

      await user.click(screen.getByRole('button', { name: /view all/i }));

      expect(mockNavigate).toHaveBeenCalledWith('/sessions');
    });

    it('should navigate to terminal when a session row is clicked', async () => {
      const user = userEvent.setup({ delay: null });
      const session = makeSession({ id: 'session-abc', name: 'Click Me' });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 6 }),
        ),
      );

      render(<ActiveSessionsPanel />);

      await waitFor(() => {
        expect(screen.getByText('Click Me')).toBeInTheDocument();
      });

      const listItem = screen.getByText('Click Me').closest('li') as HTMLElement;
      await user.click(listItem);

      expect(mockNavigate).toHaveBeenCalledWith('/sessions/session-abc/terminal');
    });

    it('should navigate to terminal when Open button is clicked', async () => {
      const user = userEvent.setup({ delay: null });
      const session = makeSession({ id: 'session-xyz' });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 6 }),
        ),
      );

      render(<ActiveSessionsPanel />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /open/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /open/i }));

      expect(mockNavigate).toHaveBeenCalledWith('/sessions/session-xyz/terminal');
    });
  });

  describe('Relative Time Display', () => {
    it('should display "just now" for very recent activity', async () => {
      const session = makeSession({
        lastActivityAt: new Date().toISOString(),
      });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 6 }),
        ),
      );

      render(<ActiveSessionsPanel />);

      await waitFor(() => {
        expect(screen.getByText(/just now/i)).toBeInTheDocument();
      });
    });

    it('should display minutes ago for recent activity', async () => {
      const session = makeSession({
        lastActivityAt: new Date(Date.now() - 5 * 60000).toISOString(),
      });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 6 }),
        ),
      );

      render(<ActiveSessionsPanel />);

      await waitFor(() => {
        expect(screen.getByText(/5m ago/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should render empty state when API fails', async () => {
      server.use(
        http.get(`${API_BASE}/sessions`, () => HttpResponse.error()),
      );

      render(<ActiveSessionsPanel />);

      await waitFor(() => {
        expect(screen.getByText(/no active sessions/i)).toBeInTheDocument();
      });
    });
  });
});
