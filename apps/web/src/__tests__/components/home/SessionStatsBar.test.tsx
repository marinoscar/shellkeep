import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { render } from '../../utils/test-utils';
import { SessionStatsBar } from '../../../components/home/SessionStatsBar';

const API_BASE = '*/api';

function setupHandlers({
  activeTotal = 0,
  detachedTotal = 0,
  serversTotal = 0,
}: {
  activeTotal?: number;
  detachedTotal?: number;
  serversTotal?: number;
} = {}) {
  server.use(
    http.get(`${API_BASE}/sessions`, ({ request }) => {
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      if (status === 'active') {
        return HttpResponse.json({ items: [], total: activeTotal, page: 1, pageSize: 1 });
      }
      if (status === 'detached') {
        return HttpResponse.json({ items: [], total: detachedTotal, page: 1, pageSize: 1 });
      }
      return HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 1 });
    }),
    http.get(`${API_BASE}/server-profiles`, () =>
      HttpResponse.json({ items: [], total: serversTotal, page: 1, pageSize: 1 }),
    ),
  );
}

describe('SessionStatsBar', () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  describe('Rendering', () => {
    it('should render three stat chips', async () => {
      setupHandlers();

      render(<SessionStatsBar />);

      await waitFor(() => {
        // At minimum the chip labels should appear
        const chips = document.querySelectorAll('.MuiChip-root');
        expect(chips.length).toBeGreaterThanOrEqual(3);
      });
    });

    it('should display active sessions count', async () => {
      setupHandlers({ activeTotal: 3 });

      render(<SessionStatsBar />);

      await waitFor(() => {
        expect(screen.getByText(/3 active session/i)).toBeInTheDocument();
      });
    });

    it('should display detached sessions count', async () => {
      setupHandlers({ detachedTotal: 2 });

      render(<SessionStatsBar />);

      await waitFor(() => {
        expect(screen.getByText(/2 detached/i)).toBeInTheDocument();
      });
    });

    it('should display server count', async () => {
      setupHandlers({ serversTotal: 5 });

      render(<SessionStatsBar />);

      await waitFor(() => {
        expect(screen.getByText(/5 servers/i)).toBeInTheDocument();
      });
    });
  });

  describe('Zero Counts', () => {
    it('should display "0 active sessions" when there are no active sessions', async () => {
      setupHandlers({ activeTotal: 0 });

      render(<SessionStatsBar />);

      await waitFor(() => {
        expect(screen.getByText(/0 active sessions/i)).toBeInTheDocument();
      });
    });

    it('should display "0 detached" when there are no detached sessions', async () => {
      setupHandlers({ detachedTotal: 0 });

      render(<SessionStatsBar />);

      await waitFor(() => {
        expect(screen.getByText(/0 detached/i)).toBeInTheDocument();
      });
    });

    it('should display "0 servers" when there are no server profiles', async () => {
      setupHandlers({ serversTotal: 0 });

      render(<SessionStatsBar />);

      await waitFor(() => {
        expect(screen.getByText(/0 servers/i)).toBeInTheDocument();
      });
    });
  });

  describe('Pluralisation', () => {
    it('should use singular "session" when there is exactly 1 active session', async () => {
      setupHandlers({ activeTotal: 1 });

      render(<SessionStatsBar />);

      await waitFor(() => {
        // "1 active session" (no trailing 's')
        expect(screen.getByText(/1 active session$/i)).toBeInTheDocument();
      });
    });

    it('should use plural "sessions" when there are 2+ active sessions', async () => {
      setupHandlers({ activeTotal: 2 });

      render(<SessionStatsBar />);

      await waitFor(() => {
        expect(screen.getByText(/2 active sessions/i)).toBeInTheDocument();
      });
    });

    it('should use singular "server" when there is exactly 1 server', async () => {
      setupHandlers({ serversTotal: 1 });

      render(<SessionStatsBar />);

      await waitFor(() => {
        expect(screen.getByText(/1 server$/i)).toBeInTheDocument();
      });
    });

    it('should use plural "servers" when there are 2+ servers', async () => {
      setupHandlers({ serversTotal: 4 });

      render(<SessionStatsBar />);

      await waitFor(() => {
        expect(screen.getByText(/4 servers/i)).toBeInTheDocument();
      });
    });
  });

  describe('Chip Colours', () => {
    it('should render active sessions chip with success colour', async () => {
      setupHandlers({ activeTotal: 1 });

      const { container } = render(<SessionStatsBar />);

      await waitFor(() => {
        const successChip = container.querySelector(
          '.MuiChip-colorSuccess',
        );
        expect(successChip).toBeInTheDocument();
      });
    });

    it('should render detached chip with warning colour', async () => {
      setupHandlers({ detachedTotal: 1 });

      const { container } = render(<SessionStatsBar />);

      await waitFor(() => {
        const warningChip = container.querySelector('.MuiChip-colorWarning');
        expect(warningChip).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should remain at 0 counts when API calls fail', async () => {
      server.use(
        http.get(`${API_BASE}/sessions`, () => HttpResponse.error()),
        http.get(`${API_BASE}/server-profiles`, () => HttpResponse.error()),
      );

      render(<SessionStatsBar />);

      // Wait a bit for fetches to fail
      await waitFor(() => {
        expect(screen.getByText(/0 active sessions/i)).toBeInTheDocument();
        expect(screen.getByText(/0 detached/i)).toBeInTheDocument();
        expect(screen.getByText(/0 servers/i)).toBeInTheDocument();
      });
    });
  });

  describe('New Session Button', () => {
    it('should render New Session button when onNewSession is provided', async () => {
      setupHandlers();

      render(<SessionStatsBar onNewSession={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument();
      });
    });

    it('should not render New Session button when onNewSession is not provided', async () => {
      setupHandlers();

      render(<SessionStatsBar />);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /new session/i })).not.toBeInTheDocument();
      });
    });

    it('should call onNewSession when New Session button is clicked', async () => {
      setupHandlers();
      const onNewSession = vi.fn();
      const user = userEvent.setup();

      render(<SessionStatsBar onNewSession={onNewSession} />);

      const button = await screen.findByRole('button', { name: /new session/i });
      await user.click(button);

      expect(onNewSession).toHaveBeenCalledTimes(1);
    });
  });
});
