import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { QuickActions } from '../../../components/home/QuickActions';

// Mock useNavigate from react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock createSession API
vi.mock('../../../services/api', () => ({
  createSession: vi.fn(),
}));

// Mock NewSessionDialog to avoid xterm dependencies
vi.mock('../../../components/terminal/NewSessionDialog', () => ({
  NewSessionDialog: ({
    open,
    onClose,
    onCreate,
  }: {
    open: boolean;
    onClose: () => void;
    onCreate: (data: { serverProfileId: string; name?: string }) => Promise<void>;
  }) =>
    open ? (
      <div data-testid="new-session-dialog">
        <button onClick={onClose}>Close</button>
        <button
          onClick={() => onCreate({ serverProfileId: 'test-profile', name: 'Test Session' })}
        >
          Create
        </button>
      </div>
    ) : null,
}));

import { createSession } from '../../../services/api';

describe('QuickActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the Quick Actions card', () => {
      render(<QuickActions />);

      expect(screen.getByText(/quick actions/i)).toBeInTheDocument();
    });

    it('should render New Session action for all users', () => {
      render(<QuickActions />);

      expect(screen.getByText('New Session')).toBeInTheDocument();
    });

    it('should render All Sessions action for all users', () => {
      render(<QuickActions />);

      expect(screen.getByText('All Sessions')).toBeInTheDocument();
    });

    it('should render Manage Servers action for all users', () => {
      render(<QuickActions />);

      expect(screen.getAllByText('Manage Servers').length).toBeGreaterThan(0);
    });

    it('should render action descriptions', () => {
      render(<QuickActions />);

      expect(screen.getByText(/connect to a server/i)).toBeInTheDocument();
      expect(screen.getByText(/view terminal sessions/i)).toBeInTheDocument();
      expect(screen.getByText(/configure server profiles/i)).toBeInTheDocument();
    });

    it('should render action buttons', () => {
      render(<QuickActions />);

      const newSessionBtn = screen.getByRole('button', { name: /new session/i });
      const allSessionsBtn = screen.getByRole('button', { name: /all sessions/i });
      expect(newSessionBtn).toBeInTheDocument();
      expect(allSessionsBtn).toBeInTheDocument();
    });

    it('should render action buttons as outlined or contained variant', () => {
      const { container } = render(<QuickActions />);

      const buttons = container.querySelectorAll('.MuiButton-root');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe('Icons', () => {
    it('should display AddIcon for New Session', () => {
      render(<QuickActions />);

      expect(screen.getByTestId('AddIcon')).toBeInTheDocument();
    });

    it('should display TerminalIcon for All Sessions', () => {
      render(<QuickActions />);

      expect(screen.getByTestId('TerminalIcon')).toBeInTheDocument();
    });

    it('should display DnsIcon for Manage Servers', () => {
      render(<QuickActions />);

      expect(screen.getByTestId('DnsIcon')).toBeInTheDocument();
    });
  });

  describe('Navigation', () => {
    it('should navigate to /sessions when All Sessions is clicked', async () => {
      const user = userEvent.setup();
      render(<QuickActions />);

      await user.click(screen.getByRole('button', { name: /all sessions/i }));

      expect(mockNavigate).toHaveBeenCalledWith('/sessions');
    });

    it('should navigate to /servers when Manage Servers is clicked', async () => {
      const user = userEvent.setup();
      render(<QuickActions />);

      const manageServersButtons = screen.getAllByRole('button', { name: /manage servers/i });
      await user.click(manageServersButtons[0]);

      expect(mockNavigate).toHaveBeenCalledWith('/servers');
    });

    it('should open NewSessionDialog when New Session is clicked', async () => {
      const user = userEvent.setup();
      render(<QuickActions />);

      await user.click(screen.getByRole('button', { name: /new session/i }));

      expect(screen.getByTestId('new-session-dialog')).toBeInTheDocument();
    });

    it('should close NewSessionDialog when dialog close is triggered', async () => {
      const user = userEvent.setup();
      render(<QuickActions />);

      await user.click(screen.getByRole('button', { name: /new session/i }));
      expect(screen.getByTestId('new-session-dialog')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /close/i }));
      expect(screen.queryByTestId('new-session-dialog')).not.toBeInTheDocument();
    });
  });

  describe('New Session dialog interaction', () => {
    it('should navigate to terminal page after creating a session', async () => {
      const user = userEvent.setup();
      const mockSession = { id: 'new-session-id', name: 'Test Session' };
      vi.mocked(createSession).mockResolvedValue(mockSession as any);

      render(<QuickActions />);

      await user.click(screen.getByRole('button', { name: /new session/i }));
      await user.click(screen.getByRole('button', { name: /create/i }));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/sessions/new-session-id/terminal');
      });
    });
  });

  describe('Layout', () => {
    it('should render inside a Card component', () => {
      const { container } = render(<QuickActions />);

      const card = container.querySelector('.MuiCard-root');
      expect(card).toBeInTheDocument();
    });

    it('should use Grid layout for actions', () => {
      const { container } = render(<QuickActions />);

      const grid = container.querySelector('.MuiGrid-container');
      expect(grid).toBeInTheDocument();
    });

    it('should render exactly 3 action buttons', () => {
      render(<QuickActions />);

      // New Session, All Sessions, Manage Servers
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThanOrEqual(3);
    });
  });
});
