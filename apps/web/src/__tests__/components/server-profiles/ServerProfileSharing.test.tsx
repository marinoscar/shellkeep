// Sharing in the server list (issue #71): the owner chip, the "Shared with me" filter, and the
// row actions each profile's `access.can` allows. The API decides; the list only hides what the
// caller cannot do.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { ServerProfileList } from '../../../components/server-profiles/ServerProfileList';
import type { ServerProfile } from '../../../types';

vi.mock('../../../hooks/useServerProfiles', () => ({ useServerProfiles: vi.fn() }));
vi.mock('../../../components/server-profiles/ServerProfileForm', () => ({ ServerProfileForm: () => null }));
// The platform dialog needs the host; what the list passes to it is what is under test.
vi.mock('../../../components/common/ShareResourceDialog', () => ({
  ShareResourceDialog: vi.fn(({ open, resourceType, resourceId, title, onClose }) =>
    open ? (
      <div data-testid="share-dialog">
        {resourceType}:{resourceId}:{title}
        <button onClick={onClose}>CloseShare</button>
      </div>
    ) : null,
  ),
}));

import { useServerProfiles } from '../../../hooks/useServerProfiles';

const CAN_ALL = { connect: true, test: true, write: true, share: true, delete: true };

const base = {
  port: 22,
  username: 'ops',
  authMethod: 'agent' as const,
  fingerprint: null,
  tags: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mine: ServerProfile = {
  ...base,
  id: 'p-mine',
  name: 'Own server',
  hostname: 'mine.example.test',
  hasPassword: false,
  owner: { kind: 'user', id: 'u-a', name: 'Person A' },
  access: { role: 'owner', via: 'owner', shared: false, credentialHolder: true, can: CAN_ALL },
};

const operated: ServerProfile = {
  ...base,
  id: 'p-shared',
  name: 'Shared box',
  hostname: 'shared.example.test',
  owner: { kind: 'user', id: 'u-b', name: 'Person B' },
  access: {
    role: 'operator',
    via: 'group_grant',
    shared: true,
    credentialHolder: false,
    can: { connect: true, test: true, write: false, share: false, delete: false },
  },
};

const grouped: ServerProfile = {
  ...base,
  id: 'p-group',
  name: 'Team box',
  hostname: 'team.example.test',
  owner: { kind: 'group', id: 'g-1', name: 'Team Alpha' },
  access: {
    role: 'viewer',
    via: 'group_owner',
    shared: true,
    credentialHolder: false,
    can: { connect: false, test: false, write: false, share: false, delete: false },
  },
};

function hook(overrides: Partial<ReturnType<typeof useServerProfiles>> = {}) {
  return {
    profiles: [mine, operated, grouped],
    total: 3,
    page: 1,
    pageSize: 10,
    isLoading: false,
    error: null,
    fetchProfiles: vi.fn().mockResolvedValue(undefined),
    createProfile: vi.fn(),
    updateProfile: vi.fn(),
    deleteProfile: vi.fn(),
    testConnection: vi.fn(),
    ...overrides,
  };
}

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

describe('ServerProfileList sharing (#71)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useServerProfiles).mockReturnValue(hook());
  });

  it('shows who owns each server: "You", a person or a group', () => {
    render(<ServerProfileList />);
    expect(within(rowOf('Own server')).getByTestId('owner-chip')).toHaveTextContent('You');
    expect(within(rowOf('Shared box')).getByTestId('owner-chip')).toHaveTextContent('Person B');
    expect(within(rowOf('Team box')).getByTestId('owner-chip')).toHaveTextContent('Team Alpha');
  });

  it('offers only what the caller may do on each row', () => {
    render(<ServerProfileList />);
    const own = within(rowOf('Own server'));
    for (const label of ['Edit', 'Test connection', 'Share', 'Delete']) {
      expect(own.getByRole('button', { name: label })).toBeInTheDocument();
    }
    // An operator may test the connection and nothing else.
    const shared = within(rowOf('Shared box'));
    expect(shared.getByRole('button', { name: 'Test connection' })).toBeInTheDocument();
    for (const label of ['Edit', 'Share', 'Delete']) {
      expect(shared.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    // A group viewer sees the server and has no action at all.
    expect(within(rowOf('Team box')).queryAllByRole('button')).toHaveLength(0);
  });

  it('opens the share dialog for the row of the server the caller may share', async () => {
    const user = userEvent.setup();
    render(<ServerProfileList />);

    await user.click(within(rowOf('Own server')).getByRole('button', { name: 'Share' }));

    expect(screen.getByTestId('share-dialog')).toHaveTextContent('server_profile:p-mine:Own server');
    await user.click(screen.getByRole('button', { name: 'CloseShare' }));
    expect(screen.queryByTestId('share-dialog')).not.toBeInTheDocument();
  });

  it('filters to "Shared with me" and reloads with that filter, and back to all', async () => {
    const user = userEvent.setup();
    const fetchProfiles = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useServerProfiles).mockReturnValue(hook({ fetchProfiles }));
    render(<ServerProfileList />);

    await user.click(screen.getByRole('button', { name: 'Shared with me' }));
    await waitFor(() => expect(fetchProfiles).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'shared' })));

    await user.click(screen.getByRole('button', { name: 'Mine' }));
    await waitFor(() => expect(fetchProfiles).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'mine' })));

    await user.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(fetchProfiles).toHaveBeenLastCalledWith(expect.objectContaining({ filter: undefined })));
  });

  it('says nothing is shared yet on an empty "Shared with me" view', async () => {
    const user = userEvent.setup();
    vi.mocked(useServerProfiles).mockReturnValue(hook({ profiles: [], total: 0 }));
    render(<ServerProfileList />);
    await user.click(screen.getByRole('button', { name: 'Shared with me' }));
    expect(screen.getByText(/nothing is shared with you yet/i)).toBeInTheDocument();
  });
});
