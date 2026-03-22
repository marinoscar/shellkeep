import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { render } from '../../utils/test-utils';
import { QuickConnectPanel } from '../../../components/home/QuickConnectPanel';
import type { ServerProfile, TerminalSession } from '../../../types';

const API_BASE = '*/api';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function makeProfile(overrides: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id: 'sp-1',
    name: 'My Server',
    hostname: 'server.example.com',
    port: 22,
    username: 'alice',
    authMethod: 'password',
    hasPassword: true,
    hasPrivateKey: false,
    hasPassphrase: false,
    fingerprint: null,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSession(id = 'session-1'): TerminalSession {
  return {
    id,
    name: 'New Session',
    status: 'active',
    tmuxSessionId: 'tmux-1',
    cols: 220,
    rows: 50,
    lastActivityAt: new Date().toISOString(),
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
  };
}

describe('QuickConnectPanel', () => {
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
        http.get(`${API_BASE}/server-profiles`, () =>
          HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 4 }),
        ),
      );

      render(<QuickConnectPanel />);

      expect(screen.getByText(/quick connect/i)).toBeInTheDocument();
    });

    it('should render the Manage Servers button', async () => {
      server.use(
        http.get(`${API_BASE}/server-profiles`, () =>
          HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 4 }),
        ),
      );

      render(<QuickConnectPanel />);

      expect(
        screen.getByRole('button', { name: /manage servers/i }),
      ).toBeInTheDocument();
    });

    it('should show loading spinner initially', () => {
      server.use(
        http.get(`${API_BASE}/server-profiles`, async () => {
          await new Promise(() => {}); // never resolves
          return HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 4 });
        }),
      );

      render(<QuickConnectPanel />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show empty state message when there are no server profiles', async () => {
      server.use(
        http.get(`${API_BASE}/server-profiles`, () =>
          HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 4 }),
        ),
      );

      render(<QuickConnectPanel />);

      await waitFor(() => {
        expect(
          screen.getByText(/add a server to get started/i),
        ).toBeInTheDocument();
      });
    });

    it('should show Add Server button in empty state', async () => {
      server.use(
        http.get(`${API_BASE}/server-profiles`, () =>
          HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 4 }),
        ),
      );

      render(<QuickConnectPanel />);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /add server/i }),
        ).toBeInTheDocument();
      });
    });
  });

  describe('Server Profile List', () => {
    it('should render server profile names', async () => {
      const profile = makeProfile({ name: 'Prod Web Server' });

      server.use(
        http.get(`${API_BASE}/server-profiles`, () =>
          HttpResponse.json({ items: [profile], total: 1, page: 1, pageSize: 4 }),
        ),
      );

      render(<QuickConnectPanel />);

      await waitFor(() => {
        expect(screen.getByText('Prod Web Server')).toBeInTheDocument();
      });
    });

    it('should render username@hostname:port for each profile', async () => {
      const profile = makeProfile({
        hostname: 'web.example.com',
        username: 'bob',
        port: 2222,
      });

      server.use(
        http.get(`${API_BASE}/server-profiles`, () =>
          HttpResponse.json({ items: [profile], total: 1, page: 1, pageSize: 4 }),
        ),
      );

      render(<QuickConnectPanel />);

      await waitFor(() => {
        expect(screen.getByText(/bob@web\.example\.com:2222/)).toBeInTheDocument();
      });
    });

    it('should render a Connect button for each profile', async () => {
      const profile = makeProfile();

      server.use(
        http.get(`${API_BASE}/server-profiles`, () =>
          HttpResponse.json({ items: [profile], total: 1, page: 1, pageSize: 4 }),
        ),
      );

      render(<QuickConnectPanel />);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /connect/i }),
        ).toBeInTheDocument();
      });
    });

    it('should render multiple profiles', async () => {
      const profiles = [
        makeProfile({ id: 'sp-1', name: 'Server A' }),
        makeProfile({ id: 'sp-2', name: 'Server B' }),
        makeProfile({ id: 'sp-3', name: 'Server C' }),
      ];

      server.use(
        http.get(`${API_BASE}/server-profiles`, () =>
          HttpResponse.json({ items: profiles, total: 3, page: 1, pageSize: 4 }),
        ),
      );

      render(<QuickConnectPanel />);

      await waitFor(() => {
        expect(screen.getByText('Server A')).toBeInTheDocument();
        expect(screen.getByText('Server B')).toBeInTheDocument();
        expect(screen.getByText('Server C')).toBeInTheDocument();
      });
    });
  });

  describe('Connect Action', () => {
    it('should navigate to terminal after successful connect', async () => {
      const user = userEvent.setup({ delay: null });
      const profile = makeProfile({ id: 'sp-1' });
      const session = makeSession('new-session-99');

      server.use(
        http.get(`${API_BASE}/server-profiles`, () =>
          HttpResponse.json({ items: [profile], total: 1, page: 1, pageSize: 4 }),
        ),
        http.post(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ data: session }),
        ),
      );

      render(<QuickConnectPanel />);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /connect/i }),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /connect/i }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
          '/sessions/new-session-99/terminal',
        );
      });
    });

    it('should show loading spinner on the Connect button while connecting', async () => {
      const user = userEvent.setup({ delay: null });
      const profile = makeProfile({ id: 'sp-1' });

      server.use(
        http.get(`${API_BASE}/server-profiles`, () =>
          HttpResponse.json({ items: [profile], total: 1, page: 1, pageSize: 4 }),
        ),
        http.post(`${API_BASE}/sessions`, async () => {
          await new Promise(() => {}); // never resolves
          return HttpResponse.json({ data: makeSession() });
        }),
      );

      render(<QuickConnectPanel />);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /connect/i }),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /connect/i }));

      // Button should be disabled while connecting
      expect(screen.getByRole('button', { name: /connect/i })).toBeDisabled();
    });

    it('should disable all Connect buttons while one connection is in progress', async () => {
      const user = userEvent.setup({ delay: null });
      const profiles = [
        makeProfile({ id: 'sp-1', name: 'Server A' }),
        makeProfile({ id: 'sp-2', name: 'Server B' }),
      ];

      server.use(
        http.get(`${API_BASE}/server-profiles`, () =>
          HttpResponse.json({ items: profiles, total: 2, page: 1, pageSize: 4 }),
        ),
        http.post(`${API_BASE}/sessions`, async () => {
          await new Promise(() => {});
          return HttpResponse.json({ data: makeSession() });
        }),
      );

      render(<QuickConnectPanel />);

      await waitFor(() => {
        const buttons = screen.getAllByRole('button', { name: /connect/i });
        expect(buttons).toHaveLength(2);
      });

      const buttons = screen.getAllByRole('button', { name: /connect/i });
      await user.click(buttons[0]);

      buttons.forEach((btn) => expect(btn).toBeDisabled());
    });

    it('should silently handle connection errors without crashing', async () => {
      const user = userEvent.setup({ delay: null });
      const profile = makeProfile({ id: 'sp-1' });

      server.use(
        http.get(`${API_BASE}/server-profiles`, () =>
          HttpResponse.json({ items: [profile], total: 1, page: 1, pageSize: 4 }),
        ),
        http.post(`${API_BASE}/sessions`, () =>
          HttpResponse.json({ message: 'Internal error' }, { status: 500 }),
        ),
      );

      render(<QuickConnectPanel />);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /connect/i }),
        ).toBeInTheDocument();
      });

      // Should not throw
      await user.click(screen.getByRole('button', { name: /connect/i }));

      await waitFor(() => {
        // Button re-enabled after error, no navigation
        expect(
          screen.getByRole('button', { name: /connect/i }),
        ).toBeEnabled();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('Navigation', () => {
    it('should navigate to /servers when Manage Servers is clicked', async () => {
      const user = userEvent.setup({ delay: null });

      server.use(
        http.get(`${API_BASE}/server-profiles`, () =>
          HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 4 }),
        ),
      );

      render(<QuickConnectPanel />);

      await waitFor(() =>
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(),
      );

      await user.click(screen.getByRole('button', { name: /manage servers/i }));

      expect(mockNavigate).toHaveBeenCalledWith('/servers');
    });

    it('should navigate to /servers when Add Server button is clicked from empty state', async () => {
      const user = userEvent.setup({ delay: null });

      server.use(
        http.get(`${API_BASE}/server-profiles`, () =>
          HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 4 }),
        ),
      );

      render(<QuickConnectPanel />);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /add server/i }),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /add server/i }));

      expect(mockNavigate).toHaveBeenCalledWith('/servers');
    });
  });

  describe('Error Handling', () => {
    it('should render empty state when API fails to load profiles', async () => {
      server.use(
        http.get(`${API_BASE}/server-profiles`, () => HttpResponse.error()),
      );

      render(<QuickConnectPanel />);

      await waitFor(() => {
        expect(
          screen.getByText(/add a server to get started/i),
        ).toBeInTheDocument();
      });
    });
  });
});
