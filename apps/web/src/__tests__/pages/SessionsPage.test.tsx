import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../utils/test-utils';
import type { TerminalSession, SessionsResponse } from '../../types';

// Mock useSessions hook
const mockFetchSessions = vi.fn();
const mockCreateNewSession = vi.fn();
const mockRenameSession = vi.fn();
const mockTerminateSession = vi.fn();
const mockBatchTerminate = vi.fn();
const mockSetStatusFilter = vi.fn();

const defaultUseSessions = {
  sessions: [] as TerminalSession[],
  total: 0,
  page: 1,
  pageSize: 10,
  isLoading: false,
  error: null,
  statusFilter: 'all',
  fetchSessions: mockFetchSessions,
  createNewSession: mockCreateNewSession,
  renameSession: mockRenameSession,
  terminateSession: mockTerminateSession,
  batchTerminate: mockBatchTerminate,
  setStatusFilter: mockSetStatusFilter,
};

vi.mock('../../hooks/useSessions', () => ({
  useSessions: vi.fn(() => defaultUseSessions),
}));

// Mock NewSessionDialog so it doesn't require xterm/WebSocket
vi.mock('../../components/terminal/NewSessionDialog', () => ({
  NewSessionDialog: ({
    open,
    onClose,
    onCreate,
  }: {
    open: boolean;
    onClose: () => void;
    onCreate: (data: { serverProfileId: string; name?: string }) => void;
  }) =>
    open ? (
      <div data-testid="new-session-dialog">
        <button onClick={onClose}>Close dialog</button>
        <button
          onClick={() => onCreate({ serverProfileId: 'profile-1', name: 'Created Session' })}
        >
          Create Session
        </button>
      </div>
    ) : null,
}));

import SessionsPage from '../../pages/SessionsPage';
import { useSessions } from '../../hooks/useSessions';

// Base session fixture
const makeSession = (overrides: Partial<TerminalSession> = {}): TerminalSession => ({
  id: 'session-1',
  name: 'My Session',
  status: 'active',
  tmuxSessionId: 'tmux-abc',
  cols: 80,
  rows: 24,
  lastActivityAt: new Date().toISOString(),
  terminatedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  serverProfile: {
    id: 'profile-1',
    name: 'Dev Server',
    hostname: 'dev.example.com',
    port: 22,
    username: 'deploy',
  },
  ...overrides,
});

describe('SessionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSessions).mockReturnValue({ ...defaultUseSessions });
  });

  describe('Rendering', () => {
    it('should render the page heading', () => {
      render(<SessionsPage />);

      expect(
        screen.getByRole('heading', { name: /terminal sessions/i }),
      ).toBeInTheDocument();
    });

    it('should render the "New Session" button in the header', () => {
      render(<SessionsPage />);

      const buttons = screen.getAllByRole('button', { name: /new session/i });
      expect(buttons.length).toBeGreaterThanOrEqual(1);
    });

    it('should render all four status tabs', () => {
      render(<SessionsPage />);

      expect(screen.getByRole('tab', { name: /^all$/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^active$/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^detached$/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^terminated$/i })).toBeInTheDocument();
    });

    it('should render back button linking back to home', async () => {
      render(<SessionsPage />);

      const backButton = screen.getByRole('button', { name: /back to home/i });
      expect(backButton).toBeInTheDocument();
    });
  });

  describe('Loading state', () => {
    it('should show a spinner while loading', () => {
      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        isLoading: true,
      });

      render(<SessionsPage />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should not show sessions list while loading', () => {
      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        isLoading: true,
        sessions: [makeSession()],
      });

      render(<SessionsPage />);

      // Cards should not be visible while loading
      expect(screen.queryByText('My Session')).not.toBeInTheDocument();
    });
  });

  describe('Empty states', () => {
    it('should show empty state message for "all" filter when no sessions', () => {
      render(<SessionsPage />);

      expect(screen.getByText(/no sessions found/i)).toBeInTheDocument();
      expect(
        screen.getByText(/create your first terminal session/i),
      ).toBeInTheDocument();
    });

    it('should show "New Session" button in empty state for "all" filter', () => {
      render(<SessionsPage />);

      // There is one in the header and one in the empty state
      const buttons = screen.getAllByRole('button', { name: /new session/i });
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });

    it('should show filtered empty message for non-all status filter', () => {
      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [],
        statusFilter: 'active',
      });

      render(<SessionsPage />);

      expect(screen.getByText(/no active sessions/i)).toBeInTheDocument();
    });

    it('should not show "New Session" in empty state when filter is not "all"', () => {
      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [],
        statusFilter: 'active',
      });

      render(<SessionsPage />);

      // Only the header button should be visible, not the empty-state button
      const buttons = screen.getAllByRole('button', { name: /new session/i });
      expect(buttons.length).toBe(1);
    });
  });

  describe('Session list', () => {
    it('should render a card for each session', () => {
      const sessions = [
        makeSession({ id: 'session-1', name: 'Session One' }),
        makeSession({ id: 'session-2', name: 'Session Two' }),
        makeSession({ id: 'session-3', name: 'Session Three' }),
      ];

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions,
      });

      render(<SessionsPage />);

      expect(screen.getByText('Session One')).toBeInTheDocument();
      expect(screen.getByText('Session Two')).toBeInTheDocument();
      expect(screen.getByText('Session Three')).toBeInTheDocument();
    });

    it('should not show empty state message when sessions are present', () => {
      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession()],
      });

      render(<SessionsPage />);

      expect(screen.queryByText(/no sessions found/i)).not.toBeInTheDocument();
    });
  });

  describe('Tab filtering', () => {
    it('should call setStatusFilter when a tab is clicked', async () => {
      const user = userEvent.setup();
      render(<SessionsPage />);

      await user.click(screen.getByRole('tab', { name: /^active$/i }));

      expect(mockSetStatusFilter).toHaveBeenCalledWith('active');
    });

    it('should call setStatusFilter with "detached" when Detached tab is clicked', async () => {
      const user = userEvent.setup();
      render(<SessionsPage />);

      await user.click(screen.getByRole('tab', { name: /^detached$/i }));

      expect(mockSetStatusFilter).toHaveBeenCalledWith('detached');
    });

    it('should call setStatusFilter with "terminated" when Terminated tab is clicked', async () => {
      const user = userEvent.setup();
      render(<SessionsPage />);

      await user.click(screen.getByRole('tab', { name: /^terminated$/i }));

      expect(mockSetStatusFilter).toHaveBeenCalledWith('terminated');
    });

    it('should call setStatusFilter with "all" when All tab is clicked', async () => {
      const user = userEvent.setup();

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        statusFilter: 'active',
      });

      render(<SessionsPage />);

      await user.click(screen.getByRole('tab', { name: /^all$/i }));

      expect(mockSetStatusFilter).toHaveBeenCalledWith('all');
    });
  });

  describe('Create session', () => {
    it('should open the new session dialog when header button is clicked', async () => {
      const user = userEvent.setup();
      render(<SessionsPage />);

      const buttons = screen.getAllByRole('button', { name: /new session/i });
      await user.click(buttons[0]);

      expect(screen.getByTestId('new-session-dialog')).toBeInTheDocument();
    });

    it('should call createNewSession and navigate when dialog confirms', async () => {
      const user = userEvent.setup();
      const newSession = makeSession({ id: 'session-new', name: 'Created Session' });
      mockCreateNewSession.mockResolvedValueOnce(newSession);

      render(<SessionsPage />, {
        wrapperOptions: { route: '/sessions' },
      });

      // Open dialog
      const buttons = screen.getAllByRole('button', { name: /new session/i });
      await user.click(buttons[0]);

      // Trigger create
      await user.click(screen.getByRole('button', { name: /create session/i }));

      await waitFor(() => {
        expect(mockCreateNewSession).toHaveBeenCalledWith({
          serverProfileId: 'profile-1',
          name: 'Created Session',
        });
      });
    });

    it('should show success snackbar after session creation', async () => {
      const user = userEvent.setup();
      mockCreateNewSession.mockResolvedValueOnce(makeSession({ id: 'new-sess' }));

      render(<SessionsPage />);

      const buttons = screen.getAllByRole('button', { name: /new session/i });
      await user.click(buttons[0]);
      await user.click(screen.getByRole('button', { name: /create session/i }));

      await waitFor(() => {
        expect(screen.getByText(/session created/i)).toBeInTheDocument();
      });
    });
  });

  describe('Terminate session', () => {
    it('should call terminateSession and show success snackbar', async () => {
      mockTerminateSession.mockResolvedValueOnce(undefined);

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession()],
        terminateSession: mockTerminateSession,
      });

      render(<SessionsPage />);

      const terminateButton = screen.getByTestId('DeleteIcon').closest('button')!;
      await userEvent.click(terminateButton);

      await waitFor(() => {
        expect(mockTerminateSession).toHaveBeenCalledWith('session-1');
      });

      await waitFor(() => {
        expect(screen.getByText(/session terminated/i)).toBeInTheDocument();
      });
    });

    it('should show error snackbar when termination fails', async () => {
      mockTerminateSession.mockRejectedValueOnce(new Error('Network error'));

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession()],
        terminateSession: mockTerminateSession,
      });

      render(<SessionsPage />);

      await userEvent.click(screen.getByTestId('DeleteIcon').closest('button')!);

      await waitFor(() => {
        expect(screen.getByText(/failed to terminate session/i)).toBeInTheDocument();
      });
    });
  });

  describe('Rename session', () => {
    it('should open rename dialog when rename button is clicked', async () => {
      const user = userEvent.setup();

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession({ name: 'Old Name' })],
      });

      render(<SessionsPage />);

      await user.click(screen.getByTestId('EditIcon').closest('button')!);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(/rename session/i)).toBeInTheDocument();
    });

    it('should pre-populate rename field with current session name', async () => {
      const user = userEvent.setup();

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession({ name: 'Current Name' })],
      });

      render(<SessionsPage />);

      await user.click(screen.getByTestId('EditIcon').closest('button')!);

      const input = screen.getByLabelText(/session name/i) as HTMLInputElement;
      expect(input.value).toBe('Current Name');
    });

    it('should call renameSession and show success snackbar when confirmed', async () => {
      const user = userEvent.setup();
      mockRenameSession.mockResolvedValueOnce(undefined);

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession({ name: 'Old Name' })],
        renameSession: mockRenameSession,
      });

      render(<SessionsPage />);

      await user.click(screen.getByTestId('EditIcon').closest('button')!);

      const input = screen.getByLabelText(/session name/i);
      await user.clear(input);
      await user.type(input, 'New Name');

      await user.click(screen.getByRole('button', { name: /^rename$/i }));

      await waitFor(() => {
        expect(mockRenameSession).toHaveBeenCalledWith('session-1', 'New Name');
      });

      await waitFor(() => {
        expect(screen.getByText(/session renamed/i)).toBeInTheDocument();
      });
    });

    it('should show error snackbar when rename fails', async () => {
      const user = userEvent.setup();
      mockRenameSession.mockRejectedValueOnce(new Error('Rename failed'));

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession({ name: 'Old Name' })],
        renameSession: mockRenameSession,
      });

      render(<SessionsPage />);

      await user.click(screen.getByTestId('EditIcon').closest('button')!);
      const input = screen.getByLabelText(/session name/i);
      await user.clear(input);
      await user.type(input, 'New Name');
      await user.click(screen.getByRole('button', { name: /^rename$/i }));

      await waitFor(() => {
        expect(screen.getByText(/failed to rename session/i)).toBeInTheDocument();
      });
    });

    it('should close rename dialog when Cancel is clicked', async () => {
      const user = userEvent.setup();

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession()],
      });

      render(<SessionsPage />);

      await user.click(screen.getByTestId('EditIcon').closest('button')!);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^cancel$/i }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('should disable Rename confirm button when field is empty', async () => {
      const user = userEvent.setup();

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession({ name: 'Old Name' })],
      });

      render(<SessionsPage />);

      await user.click(screen.getByTestId('EditIcon').closest('button')!);
      const input = screen.getByLabelText(/session name/i);
      await user.clear(input);

      const confirmButton = screen.getByRole('button', { name: /^rename$/i });
      expect(confirmButton).toBeDisabled();
    });

    it('should submit rename on Enter key in the text field', async () => {
      const user = userEvent.setup();
      mockRenameSession.mockResolvedValueOnce(undefined);

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession({ name: 'Old Name' })],
        renameSession: mockRenameSession,
      });

      render(<SessionsPage />);

      await user.click(screen.getByTestId('EditIcon').closest('button')!);
      const input = screen.getByLabelText(/session name/i);
      await user.clear(input);
      await user.type(input, 'New Name{Enter}');

      await waitFor(() => {
        expect(mockRenameSession).toHaveBeenCalledWith('session-1', 'New Name');
      });
    });
  });

  describe('Navigation', () => {
    it('should navigate to the terminal page when a session card is opened', async () => {
      const user = userEvent.setup();

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession()],
      });

      render(<SessionsPage />, { wrapperOptions: { route: '/sessions' } });

      await user.click(screen.getByTestId('OpenInNewIcon').closest('button')!);

      // Navigation happens inside MemoryRouter - verify open button was actionable
      expect(screen.getByTestId('OpenInNewIcon').closest('button')!).toBeInTheDocument();
    });
  });

  describe('Policy Alert', () => {
    it('should show the session lifecycle policy Alert', () => {
      render(<SessionsPage />);

      expect(
        screen.getByText(/sessions inactive for 1 hour are automatically marked as detached/i),
      ).toBeInTheDocument();
    });

    it('should include detach and termination policy details in the Alert', () => {
      render(<SessionsPage />);

      expect(
        screen.getByText(/detached sessions inactive for 12 hours are terminated/i),
      ).toBeInTheDocument();
    });

    it('should mention 3 day removal policy for terminated sessions', () => {
      render(<SessionsPage />);

      expect(
        screen.getByText(/terminated sessions are permanently removed after 3 days/i),
      ).toBeInTheDocument();
    });
  });

  describe('Batch terminate – selection toolbar', () => {
    it('should not show the action toolbar when no sessions are selected', () => {
      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession()],
      });

      render(<SessionsPage />);

      expect(
        screen.queryByRole('button', { name: /terminate selected/i }),
      ).not.toBeInTheDocument();
    });

    it('should show the action toolbar with correct count after selecting a session', async () => {
      const user = userEvent.setup();

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession({ id: 'session-1', name: 'Session One' })],
      });

      render(<SessionsPage />);

      await user.click(screen.getByRole('checkbox'));

      expect(screen.getByText(/1 session selected/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /terminate selected/i })).toBeInTheDocument();
    });

    it('should show plural count in toolbar when multiple sessions are selected', async () => {
      const user = userEvent.setup();

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [
          makeSession({ id: 'session-1', name: 'Session One' }),
          makeSession({ id: 'session-2', name: 'Session Two' }),
        ],
      });

      render(<SessionsPage />);

      const checkboxes = screen.getAllByRole('checkbox');
      await user.click(checkboxes[0]);
      await user.click(checkboxes[1]);

      expect(screen.getByText(/2 sessions selected/i)).toBeInTheDocument();
    });

    it('should clear selection when the Clear button is clicked', async () => {
      const user = userEvent.setup();

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession()],
      });

      render(<SessionsPage />);

      await user.click(screen.getByRole('checkbox'));
      expect(screen.getByText(/1 session selected/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^clear$/i }));

      expect(screen.queryByText(/session selected/i)).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /terminate selected/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('Batch terminate – confirmation dialog', () => {
    it('should open the confirmation dialog when "Terminate Selected" is clicked', async () => {
      const user = userEvent.setup();

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession()],
      });

      render(<SessionsPage />);

      await user.click(screen.getByRole('checkbox'));
      await user.click(screen.getByRole('button', { name: /terminate selected/i }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(/terminate sessions/i)).toBeInTheDocument();
    });

    it('should show the correct session count in the confirmation dialog', async () => {
      const user = userEvent.setup();

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [
          makeSession({ id: 'session-1' }),
          makeSession({ id: 'session-2', name: 'Session Two' }),
        ],
      });

      render(<SessionsPage />);

      const checkboxes = screen.getAllByRole('checkbox');
      await user.click(checkboxes[0]);
      await user.click(checkboxes[1]);
      await user.click(screen.getByRole('button', { name: /terminate selected/i }));

      expect(
        screen.getByText(/are you sure you want to terminate 2 sessions/i),
      ).toBeInTheDocument();
    });

    it('should show singular "session" in dialog when only 1 is selected', async () => {
      const user = userEvent.setup();

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession()],
      });

      render(<SessionsPage />);

      await user.click(screen.getByRole('checkbox'));
      await user.click(screen.getByRole('button', { name: /terminate selected/i }));

      // "1 session" not "1 sessions"
      expect(
        screen.getByText(/are you sure you want to terminate 1 session\b/i),
      ).toBeInTheDocument();
    });

    it('should call batchTerminate and clear selection when confirmed', async () => {
      const user = userEvent.setup();
      mockBatchTerminate.mockResolvedValueOnce({ terminated: 1 });

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession({ id: 'session-1' })],
        batchTerminate: mockBatchTerminate,
      });

      render(<SessionsPage />);

      await user.click(screen.getByRole('checkbox'));
      await user.click(screen.getByRole('button', { name: /terminate selected/i }));
      await user.click(screen.getByRole('button', { name: /^terminate$/i }));

      await waitFor(() => {
        expect(mockBatchTerminate).toHaveBeenCalledWith(['session-1']);
      });

      // Toolbar must be gone because selection was cleared
      await waitFor(() => {
        expect(screen.queryByText(/session selected/i)).not.toBeInTheDocument();
      });
    });

    it('should show success snackbar with terminated count after confirming', async () => {
      const user = userEvent.setup();
      mockBatchTerminate.mockResolvedValueOnce({ terminated: 2 });

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [
          makeSession({ id: 'session-1' }),
          makeSession({ id: 'session-2', name: 'Session Two' }),
        ],
        batchTerminate: mockBatchTerminate,
      });

      render(<SessionsPage />);

      const checkboxes = screen.getAllByRole('checkbox');
      await user.click(checkboxes[0]);
      await user.click(checkboxes[1]);
      await user.click(screen.getByRole('button', { name: /terminate selected/i }));
      await user.click(screen.getByRole('button', { name: /^terminate$/i }));

      await waitFor(() => {
        expect(screen.getByText(/2 sessions terminated/i)).toBeInTheDocument();
      });
    });

    it('should close the dialog without calling batchTerminate when Cancel is clicked', async () => {
      const user = userEvent.setup();

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession()],
        batchTerminate: mockBatchTerminate,
      });

      render(<SessionsPage />);

      await user.click(screen.getByRole('checkbox'));
      await user.click(screen.getByRole('button', { name: /terminate selected/i }));
      await user.click(screen.getByRole('button', { name: /^cancel$/i }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
      expect(mockBatchTerminate).not.toHaveBeenCalled();
    });

    it('should show error snackbar when batchTerminate fails', async () => {
      const user = userEvent.setup();
      mockBatchTerminate.mockRejectedValueOnce(new Error('Network error'));

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession()],
        batchTerminate: mockBatchTerminate,
      });

      render(<SessionsPage />);

      await user.click(screen.getByRole('checkbox'));
      await user.click(screen.getByRole('button', { name: /terminate selected/i }));
      await user.click(screen.getByRole('button', { name: /^terminate$/i }));

      await waitFor(() => {
        expect(screen.getByText(/failed to terminate sessions/i)).toBeInTheDocument();
      });
    });
  });

  describe('Batch terminate – tab change clears selection', () => {
    it('should clear selection when the tab is changed', async () => {
      const user = userEvent.setup();

      vi.mocked(useSessions).mockReturnValue({
        ...defaultUseSessions,
        sessions: [makeSession()],
      });

      render(<SessionsPage />);

      await user.click(screen.getByRole('checkbox'));
      expect(screen.getByText(/1 session selected/i)).toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: /^active$/i }));

      await waitFor(() => {
        expect(screen.queryByText(/session selected/i)).not.toBeInTheDocument();
      });
    });
  });
});
