import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';

const { mockNavigate, mockLogout } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockLogout: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@marinoscar/platform-web/identity/headless', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@marinoscar/platform-web/identity/headless')>();
  return { ...actual, useAuth: () => ({ logout: mockLogout }) };
});

vi.mock('../../../services/api', () => ({
  api: { getAccessToken: vi.fn(() => 'mock-token') },
  // The platform host (rendered by the test wrapper) spreads the app's client.
  platformApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { TerminalConnectionAlert } from '../../../components/terminal/TerminalConnectionAlert';
import {
  EXPIRED_MESSAGE,
  FORBIDDEN_MESSAGE,
  MAINTENANCE_MESSAGE,
} from '../../../services/terminal-ws';

describe('TerminalConnectionAlert (#93)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLogout.mockResolvedValue(undefined);
  });

  it('renders nothing without an error', () => {
    render(<TerminalConnectionAlert error={null} />);
    expect(screen.queryByTestId('terminal-connection-alert')).not.toBeInTheDocument();
  });

  it('"Sign in again" ends the session and opens login with a way back to this terminal', async () => {
    const user = userEvent.setup();
    render(<TerminalConnectionAlert error={EXPIRED_MESSAGE} />, {
      wrapperOptions: { route: '/terminal/session-1?x=1' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(EXPIRED_MESSAGE);
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/login', {
        replace: true,
        state: { from: { pathname: '/terminal/session-1', search: '?x=1' } },
      }),
    );
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockLogout.mock.invocationCallOrder[0]).toBeLessThan(
      mockNavigate.mock.invocationCallOrder[0],
    );
  });

  it('offers "Back to sessions" for the forbidden message and cannot be dismissed', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<TerminalConnectionAlert error={FORBIDDEN_MESSAGE} onDismiss={onDismiss} />);

    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(mockNavigate).toHaveBeenCalledWith('/sessions');
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('shows the maintenance refusal with Retry and no dismiss (#46)', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(
      <TerminalConnectionAlert error={MAINTENANCE_MESSAGE} onDismiss={onDismiss} onRetry={onRetry} />,
    );

    const alert = screen.getByTestId('terminal-connection-alert');
    expect(alert).toHaveTextContent(
      'ShellKeep is in maintenance. New terminal sessions are paused; try again later.',
    );
    expect(alert).toHaveAttribute('data-variant', 'maintenance');
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('lets the user dismiss any other error', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<TerminalConnectionAlert error="WebSocket error" onDismiss={onDismiss} />);

    expect(screen.queryByRole('button', { name: 'Sign in again' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
