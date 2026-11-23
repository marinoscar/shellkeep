import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render, mockUser } from '../../utils/test-utils';
import { TerminalAccessGate } from '../../../components/terminal/TerminalAccessGate';

describe('TerminalAccessGate (#47)', () => {
  it('renders the terminal for a holder of sessions:write', () => {
    render(
      <TerminalAccessGate>
        <div data-testid="terminal" />
      </TerminalAccessGate>,
      { wrapperOptions: { user: { ...mockUser, permissions: ['sessions:read', 'sessions:write'] } } },
    );
    expect(screen.getByTestId('terminal')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-read-only')).not.toBeInTheDocument();
  });

  it('shows the read-only message instead of the terminal without sessions:write', () => {
    render(
      <TerminalAccessGate>
        <div data-testid="terminal" />
      </TerminalAccessGate>,
      { wrapperOptions: { user: { ...mockUser, roles: [{ name: 'viewer' }], permissions: ['sessions:read'] } } },
    );
    expect(screen.queryByTestId('terminal')).not.toBeInTheDocument();
    expect(screen.getByText('Read-only access')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to sessions/i })).toBeInTheDocument();
  });

  it('decides on the permission, not the role name', () => {
    render(
      <TerminalAccessGate>
        <div data-testid="terminal" />
      </TerminalAccessGate>,
      { wrapperOptions: { user: { ...mockUser, roles: [{ name: 'admin' }], permissions: [] } } },
    );
    expect(screen.queryByTestId('terminal')).not.toBeInTheDocument();
  });
});
