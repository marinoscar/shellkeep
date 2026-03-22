import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { render } from '../../utils/test-utils';
import { RecentActivityPanel } from '../../../components/home/RecentActivityPanel';
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
    lastActivityAt: new Date(Date.now() - 3 * 60000).toISOString(), // 3 min ago
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

describe('RecentActivityPanel', () => {
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
          HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 5 }),
        ),
      );

      render(<RecentActivityPanel />);

      expect(screen.getByText(/recent activity/i)).toBeInTheDocument();
    });

    it('should show loading spinner initially', () => {
      server.use(
        http.get(`${API_BASE}/sessions`, async () => {
          await new Promise(() => {});
          return HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 5 });
        }),
      );

      render(<RecentActivityPanel />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty state text when there are no sessions', async () => {
      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 5 }),
        ),
      );

      render(<RecentActivityPanel />);

      await waitFor(() => {
        expect(screen.getByText(/no recent activity/i)).toBeInTheDocument();
      });
    });
  });

  describe('Activity List', () => {
    it('should render session names', async () => {
      const session = makeSession({ name: 'Deploy Session' });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 5 }),
        ),
      );

      render(<RecentActivityPanel />);

      await waitFor(() => {
        expect(screen.getByText('Deploy Session')).toBeInTheDocument();
      });
    });

    it('should render server profile details as secondary text', async () => {
      const session = makeSession();

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 5 }),
        ),
      );

      render(<RecentActivityPanel />);

      await waitFor(() => {
        // Format: "My Server (alice@server.example.com)"
        expect(
          screen.getByText(/My Server.*alice@server\.example\.com/),
        ).toBeInTheDocument();
      });
    });

    it('should render status chips for sessions', async () => {
      const session = makeSession({ status: 'active' });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 5 }),
        ),
      );

      render(<RecentActivityPanel />);

      await waitFor(() => {
        expect(screen.getByText('active')).toBeInTheDocument();
      });
    });

    it('should render detached chip for detached sessions', async () => {
      const session = makeSession({ status: 'detached' });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 5 }),
        ),
      );

      render(<RecentActivityPanel />);

      await waitFor(() => {
        expect(screen.getByText('detached')).toBeInTheDocument();
      });
    });

    it('should render terminated chip for terminated sessions', async () => {
      const session = makeSession({
        status: 'terminated',
        terminatedAt: new Date().toISOString(),
      });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 5 }),
        ),
      );

      render(<RecentActivityPanel />);

      await waitFor(() => {
        expect(screen.getByText('terminated')).toBeInTheDocument();
      });
    });

    it('should render up to 5 sessions', async () => {
      const sessions = Array.from({ length: 5 }, (_, i) =>
        makeSession({ id: `s-${i}`, name: `Session ${i + 1}` }),
      );

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: sessions, total: 5, page: 1, pageSize: 5 }),
        ),
      );

      render(<RecentActivityPanel />);

      await waitFor(() => {
        expect(screen.getByText('Session 1')).toBeInTheDocument();
        expect(screen.getByText('Session 5')).toBeInTheDocument();
      });
    });
  });

  describe('Relative Time Formatting', () => {
    it('should display "just now" for very recent activity', async () => {
      const session = makeSession({ lastActivityAt: new Date().toISOString() });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 5 }),
        ),
      );

      render(<RecentActivityPanel />);

      await waitFor(() => {
        expect(screen.getByText(/just now/i)).toBeInTheDocument();
      });
    });

    it('should display minutes for activity within the last hour', async () => {
      const session = makeSession({
        lastActivityAt: new Date(Date.now() - 10 * 60000).toISOString(),
      });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 5 }),
        ),
      );

      render(<RecentActivityPanel />);

      await waitFor(() => {
        expect(screen.getByText(/10m ago/i)).toBeInTheDocument();
      });
    });

    it('should display hours for activity within the last day', async () => {
      const session = makeSession({
        lastActivityAt: new Date(Date.now() - 3 * 3600000).toISOString(),
      });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 5 }),
        ),
      );

      render(<RecentActivityPanel />);

      await waitFor(() => {
        expect(screen.getByText(/3h ago/i)).toBeInTheDocument();
      });
    });

    it('should display days for activity within the last week', async () => {
      const session = makeSession({
        lastActivityAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 5 }),
        ),
      );

      render(<RecentActivityPanel />);

      await waitFor(() => {
        expect(screen.getByText(/2d ago/i)).toBeInTheDocument();
      });
    });
  });

  describe('Navigation', () => {
    it('should navigate to terminal when clicking an active session', async () => {
      const user = userEvent.setup({ delay: null });
      const session = makeSession({ id: 'sess-nav', name: 'Navigate Me', status: 'active' });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 5 }),
        ),
      );

      render(<RecentActivityPanel />);

      await waitFor(() => {
        expect(screen.getByText('Navigate Me')).toBeInTheDocument();
      });

      const listItem = screen.getByText('Navigate Me').closest('li') as HTMLElement;
      await user.click(listItem);

      expect(mockNavigate).toHaveBeenCalledWith('/sessions/sess-nav/terminal');
    });

    it('should navigate to terminal when clicking a detached session', async () => {
      const user = userEvent.setup({ delay: null });
      const session = makeSession({ id: 'sess-det', name: 'Detached Nav', status: 'detached' });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 5 }),
        ),
      );

      render(<RecentActivityPanel />);

      await waitFor(() => {
        expect(screen.getByText('Detached Nav')).toBeInTheDocument();
      });

      const listItem = screen.getByText('Detached Nav').closest('li') as HTMLElement;
      await user.click(listItem);

      expect(mockNavigate).toHaveBeenCalledWith('/sessions/sess-det/terminal');
    });

    it('should NOT navigate when clicking a terminated session', async () => {
      const user = userEvent.setup({ delay: null });
      const session = makeSession({
        id: 'sess-term',
        name: 'Terminated Session',
        status: 'terminated',
        terminatedAt: new Date().toISOString(),
      });

      server.use(
        http.get(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ items: [session], total: 1, page: 1, pageSize: 5 }),
        ),
      );

      render(<RecentActivityPanel />);

      await waitFor(() => {
        expect(screen.getByText('Terminated Session')).toBeInTheDocument();
      });

      const listItem = screen.getByText('Terminated Session').closest('li') as HTMLElement;
      await user.click(listItem);

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should render empty state when API fails', async () => {
      server.use(
        http.get(`${API_BASE}/sessions`, () => HttpResponse.error()),
      );

      render(<RecentActivityPanel />);

      await waitFor(() => {
        expect(screen.getByText(/no recent activity/i)).toBeInTheDocument();
      });
    });
  });
});
