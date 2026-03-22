import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../utils/test-utils';
import ServerProfilesPage from '../../pages/ServerProfilesPage';

// Mock useNavigate so we can assert navigation without a real router
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock the ServerProfileList so page-level tests stay isolated
vi.mock('../../components/server-profiles/ServerProfileList', () => ({
  ServerProfileList: vi.fn(({ onTestResult, onDeleteSuccess, onError }) => (
    <div data-testid="server-profile-list">
      <button
        onClick={() => onTestResult?.({ success: true })}
        data-testid="trigger-test-success"
      >
        Trigger Test Success
      </button>
      <button
        onClick={() => onTestResult?.({ success: false, error: 'Connection refused' })}
        data-testid="trigger-test-failure"
      >
        Trigger Test Failure
      </button>
      <button
        onClick={() => onTestResult?.({ success: false })}
        data-testid="trigger-test-failure-no-message"
      >
        Trigger Test Failure No Message
      </button>
      <button
        onClick={() => onDeleteSuccess?.()}
        data-testid="trigger-delete-success"
      >
        Trigger Delete Success
      </button>
      <button
        onClick={() => onError?.('Custom error message')}
        data-testid="trigger-error"
      >
        Trigger Error
      </button>
    </div>
  )),
}));

describe('ServerProfilesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the page heading', () => {
      render(<ServerProfilesPage />);

      expect(
        screen.getByRole('heading', { name: /server profiles/i })
      ).toBeInTheDocument();
    });

    it('should render the subtitle', () => {
      render(<ServerProfilesPage />);

      expect(
        screen.getByText(/manage ssh server connections/i)
      ).toBeInTheDocument();
    });

    it('should render the back button with accessible label', () => {
      render(<ServerProfilesPage />);

      expect(
        screen.getByRole('button', { name: /back to home/i })
      ).toBeInTheDocument();
    });

    it('should render the ServerProfileList component', () => {
      render(<ServerProfilesPage />);

      expect(screen.getByTestId('server-profile-list')).toBeInTheDocument();
    });

    it('should use a Container with maxWidth lg', () => {
      const { container } = render(<ServerProfilesPage />);

      expect(
        container.querySelector('.MuiContainer-maxWidthLg')
      ).toBeInTheDocument();
    });
  });

  describe('Back Navigation', () => {
    it('should navigate to "/" when the back button is clicked', async () => {
      const user = userEvent.setup();

      render(<ServerProfilesPage />);

      await user.click(screen.getByRole('button', { name: /back to home/i }));

      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  describe('Snackbar - Test Connection Results', () => {
    it('should show success snackbar when connection test succeeds', async () => {
      const user = userEvent.setup();

      render(<ServerProfilesPage />);

      await user.click(screen.getByTestId('trigger-test-success'));

      await waitFor(() => {
        expect(screen.getByText('Connection successful!')).toBeInTheDocument();
      });
    });

    it('should show error snackbar with specific error when connection test fails', async () => {
      const user = userEvent.setup();

      render(<ServerProfilesPage />);

      await user.click(screen.getByTestId('trigger-test-failure'));

      await waitFor(() => {
        expect(screen.getByText('Connection refused')).toBeInTheDocument();
      });
    });

    it('should show default error message when connection test fails without error string', async () => {
      const user = userEvent.setup();

      render(<ServerProfilesPage />);

      await user.click(screen.getByTestId('trigger-test-failure-no-message'));

      await waitFor(() => {
        expect(screen.getByText('Connection failed')).toBeInTheDocument();
      });
    });

    it('should render the success snackbar with success severity', async () => {
      const user = userEvent.setup();

      render(<ServerProfilesPage />);

      await user.click(screen.getByTestId('trigger-test-success'));

      await waitFor(() => {
        // MUI Alert with severity="success" has role="alert"
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Connection successful!');
        // MUI applies a class for the severity
        expect(alert.closest('.MuiAlert-filledSuccess')).toBeInTheDocument();
      });
    });

    it('should render the error snackbar with error severity', async () => {
      const user = userEvent.setup();

      render(<ServerProfilesPage />);

      await user.click(screen.getByTestId('trigger-test-failure'));

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert.closest('.MuiAlert-filledError')).toBeInTheDocument();
      });
    });
  });

  describe('Snackbar - Delete Success', () => {
    it('should show success snackbar when a profile is deleted', async () => {
      const user = userEvent.setup();

      render(<ServerProfilesPage />);

      await user.click(screen.getByTestId('trigger-delete-success'));

      await waitFor(() => {
        expect(screen.getByText('Server profile deleted')).toBeInTheDocument();
      });
    });

    it('should render delete success snackbar with success severity', async () => {
      const user = userEvent.setup();

      render(<ServerProfilesPage />);

      await user.click(screen.getByTestId('trigger-delete-success'));

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert.closest('.MuiAlert-filledSuccess')).toBeInTheDocument();
      });
    });
  });

  describe('Snackbar - Generic Error', () => {
    it('should show error snackbar when onError is triggered', async () => {
      const user = userEvent.setup();

      render(<ServerProfilesPage />);

      await user.click(screen.getByTestId('trigger-error'));

      await waitFor(() => {
        expect(screen.getByText('Custom error message')).toBeInTheDocument();
      });
    });

    it('should render the error snackbar with error severity', async () => {
      const user = userEvent.setup();

      render(<ServerProfilesPage />);

      await user.click(screen.getByTestId('trigger-error'));

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert.closest('.MuiAlert-filledError')).toBeInTheDocument();
      });
    });
  });

  describe('Snackbar - Dismiss', () => {
    it('should close the snackbar when the close button is clicked', async () => {
      const user = userEvent.setup();

      render(<ServerProfilesPage />);

      await user.click(screen.getByTestId('trigger-delete-success'));

      await waitFor(() => {
        expect(screen.getByText('Server profile deleted')).toBeInTheDocument();
      });

      // MUI Alert close button
      const closeButton = screen.getByTitle(/close/i);
      await user.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByText('Server profile deleted')).not.toBeInTheDocument();
      });
    });

    it('should auto-hide the snackbar after 4 seconds', async () => {
      vi.useFakeTimers();

      try {
        render(<ServerProfilesPage />);

        // Use fireEvent to avoid userEvent hanging with fake timers
        act(() => {
          fireEvent.click(screen.getByTestId('trigger-delete-success'));
        });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });

        expect(screen.getByText('Server profile deleted')).toBeInTheDocument();

        // Advance past autoHideDuration (4000ms) plus MUI exit animation (~1000ms)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(4000);
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });

        expect(screen.queryByText('Server profile deleted')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Snackbar - Sequential Notifications', () => {
    it('should replace the previous snackbar message with a new one', async () => {
      render(<ServerProfilesPage />);

      act(() => {
        fireEvent.click(screen.getByTestId('trigger-delete-success'));
      });

      await waitFor(() => {
        expect(screen.getByText('Server profile deleted')).toBeInTheDocument();
      });

      act(() => {
        fireEvent.click(screen.getByTestId('trigger-error'));
      });

      // After triggering a new notification, the new message should appear
      await waitFor(() => {
        expect(screen.getByText('Custom error message')).toBeInTheDocument();
      });
    });
  });
});
