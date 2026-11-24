import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import type { ServerProfile } from '../../../types';
import { HOME, PROFILE, fakeFilesHandlers, type ListRequest } from '../files/browser/fakeFiles';

// The server page's Files tab (#156): the same FileBrowser without a session,
// rooted at `~`, shown only to a caller who may open a terminal on the server.

const { openFile } = vi.hoisted(() => ({ openFile: vi.fn() }));
vi.mock('../../../components/files/viewer/FileViewerProvider', () => ({
  useOpenFile: () => ({ openFile, closeFile: vi.fn() }),
}));
vi.mock('../../../services/terminal-api', () => ({
  getSessions: vi.fn(() => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 5 })),
  updateServerProfile: vi.fn(),
  trustHostKey: vi.fn(),
  scanHostKey: vi.fn(),
  forgetHostKey: vi.fn(),
  refreshServerFacts: vi.fn(),
  getServerProfile: vi.fn(),
}));

import { ServerDetailDrawer } from '../../../components/server-profiles/ServerDetailDrawer';

const profile: ServerProfile = {
  id: PROFILE,
  name: 'server-a',
  hostname: 'server-a.example.test',
  port: 22,
  username: 'person-a',
  authMethod: 'password',
  fingerprint: null,
  tags: [],
  color: 'default',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const writer = { ...mockUser, permissions: [...mockUser.permissions, 'servers:read', 'sessions:read', 'sessions:write'] };
const reader = { ...mockUser, permissions: [...mockUser.permissions, 'servers:read', 'sessions:read'] };

let state: { cwd: string; requests: ListRequest[] };

function renderDrawer(p: ServerProfile, user = writer) {
  return render(<ServerDetailDrawer profile={p} onClose={vi.fn()} tagOptions={[]} onProfileChanged={vi.fn()} />, {
    wrapperOptions: { user },
  });
}

describe('ServerDetailDrawer Files tab (#156)', () => {
  beforeEach(() => {
    openFile.mockReset();
    state = { cwd: '/srv/app', requests: [] };
    server.use(...fakeFilesHandlers(state));
  });

  it('browses home without a session and opens a file in the viewer', async () => {
    const user = userEvent.setup();
    renderDrawer(profile);
    const tabs = screen.getByRole('tablist', { name: 'Server sections' });
    expect(within(tabs).getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
    expect(state.requests).toHaveLength(0);

    await user.click(within(tabs).getByRole('tab', { name: 'Files' }));
    const browser = screen.getByRole('region', { name: 'Files on server-a' });
    await within(browser).findByRole('list', { name: `Files in ${HOME}` });
    expect(state.requests[0]).toEqual({ path: '~', sessionId: null });
    expect(within(browser).queryByRole('switch', { name: 'Follow terminal directory' })).not.toBeInTheDocument();
    expect(screen.queryByText('Username')).not.toBeInTheDocument();

    await user.click(within(browser).getByRole('button', { name: /^notes\.txt, file/ }));
    expect(openFile).toHaveBeenCalledWith({ profileId: PROFILE, path: `${HOME}/notes.txt` });

    await user.click(within(tabs).getByRole('tab', { name: 'Details' }));
    expect(screen.getByText('Username')).toBeInTheDocument();
  });

  it('has no Files tab without sessions:write', () => {
    renderDrawer(profile, reader);
    expect(screen.queryByRole('tab', { name: 'Files' })).not.toBeInTheDocument();
    expect(screen.getByText('Username')).toBeInTheDocument();
  });

  it('has no Files tab without connect rights on a shared server', () => {
    renderDrawer({
      ...profile,
      access: {
        role: 'viewer',
        via: 'share',
        shared: true,
        credentialHolder: false,
        can: { connect: false, test: false, write: false, share: false, delete: false },
      },
    });
    expect(screen.queryByRole('tab', { name: 'Files' })).not.toBeInTheDocument();
  });
});
