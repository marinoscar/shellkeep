import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../utils/test-utils';
import type { TerminalSession } from '../../../../types';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigateMock }));
vi.mock('../../../../services/terminal-api', () => ({
  getSessions: vi.fn(),
  getServerProfiles: vi.fn(() => Promise.resolve({ items: [] })),
  createSession: vi.fn(),
}));

import { getSessions } from '../../../../services/terminal-api';
import { SessionSwitcherPane, sessionIdFromPath } from '../../../../components/terminal/workspace/SessionSwitcherPane';
import { SessionSwitcherMenu } from '../../../../components/terminal/workspace/SessionSwitcherMenu';
import { groupByServer, switchableSessions } from '../../../../components/terminal/workspace/SessionSwitcherList';

const s = (id: string, name: string, server: string, status: TerminalSession['status'], at: string) =>
  ({ id, name, status, lastActivityAt: at, serverProfile: { name: server } }) as TerminalSession;
const ITEMS = [
  s('1', 'deploy', 'server-b', 'active', '2026-01-02'),
  s('2', 'logs', 'server-a', 'detached', '2026-01-03'),
  s('3', 'old', 'server-a', 'terminated', '2026-01-04'),
];

describe('session switcher (#77)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSessions).mockResolvedValue({ items: ITEMS, total: 3, page: 1, pageSize: 100 });
  });

  it('lists the non-terminated sessions grouped by server', () => {
    const groups = groupByServer(switchableSessions(ITEMS));
    expect(groups.map((g) => [g.server, g.sessions.map((x) => x.name)])).toEqual([
      ['server-a', ['logs']],
      ['server-b', ['deploy']],
    ]);
    expect(sessionIdFromPath('/sessions/abc')).toBe('abc');
    expect(sessionIdFromPath('/servers')).toBeNull();
  });

  it('the pane marks the current session and navigates on click', async () => {
    render(<SessionSwitcherPane activeDestination="sessions" pathname="/sessions/1" />);
    const current = await screen.findByRole('button', { name: /deploy/ });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('old')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /logs/ }));
    expect(navigateMock).toHaveBeenCalledWith('/sessions/2');
  });

  it('the pane filters by name or server', async () => {
    render(<SessionSwitcherPane activeDestination="sessions" pathname="/sessions" />);
    await screen.findByRole('button', { name: /deploy/ });
    await userEvent.type(screen.getByLabelText('Filter sessions'), 'server-b');
    expect(screen.queryByRole('button', { name: /logs/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deploy/ })).toBeInTheDocument();
  });

  it('the menu fetches when opened and hands back the chosen session', async () => {
    const onSelect = vi.fn();
    render(<SessionSwitcherMenu activeId="1" onSelect={onSelect} />);
    expect(getSessions).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Switch session' }));
    await userEvent.click(await screen.findByRole('button', { name: /logs/ }));
    expect(onSelect).toHaveBeenCalledWith('2');
    await waitFor(() => expect(screen.queryByRole('button', { name: /logs/ })).not.toBeInTheDocument());
  });
});
