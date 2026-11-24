import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockUser } from '../../utils/test-utils';
import { ApiError } from '../../../services/api';
import type { ServerProfile } from '../../../types';

/** Issue #60: the host-key status, prompts and facts on the server profiles UI. */

vi.mock('../../../hooks/useServerProfiles', () => ({ useServerProfiles: vi.fn() }));
vi.mock('../../../services/terminal-api', () => ({
  trustHostKey: vi.fn(),
  getServerProfile: vi.fn(),
  scanHostKey: vi.fn(),
  forgetHostKey: vi.fn(),
  refreshServerFacts: vi.fn(),
}));

import { useServerProfiles } from '../../../hooks/useServerProfiles';
import {
  forgetHostKey,
  refreshServerFacts,
  scanHostKey,
  trustHostKey,
} from '../../../services/terminal-api';
import { ServerProfileList } from '../../../components/server-profiles/ServerProfileList';
import { ServerProfileForm } from '../../../components/server-profiles/ServerProfileForm';

const PRESENTED = 'SHA256:presentedKeyFingerprintAAAAAAAAAAAAAAAAAAAA';
const TRUSTED = 'SHA256:trustedKeyFingerprintBBBBBBBBBBBBBBBBBBBBBBB';

const base: ServerProfile = {
  id: 'profile-a',
  name: 'server-a',
  hostname: 'server-a.example.test',
  port: 22,
  username: 'person-a',
  authMethod: 'password',
  hasPassword: true,
  hasPrivateKey: false,
  hasPassphrase: false,
  fingerprint: null,
  hostKeyAlgorithm: null,
  hostKeyTrustedAt: null,
  facts: null,
  factsProbedAt: null,
  tags: [],
  color: 'default',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const trustedProfile: ServerProfile = {
  ...base,
  id: 'profile-b',
  name: 'server-b',
  hostname: 'server-b.example.test',
  fingerprint: TRUSTED,
  hostKeyAlgorithm: 'ssh-ed25519',
  hostKeyTrustedAt: '2026-01-02T00:00:00.000Z',
  facts: {
    kernel: 'Linux 6.1.0 x86_64',
    os: 'linux',
    prettyName: 'Distro X 12',
    has: ['tmux', 'sudo'],
    packageManager: 'apt',
  },
  factsProbedAt: '2026-01-02T00:00:00.000Z',
};

const writer = { ...mockUser, permissions: [...mockUser.permissions, 'servers:read', 'servers:write'] };

function hook(overrides: Partial<ReturnType<typeof useServerProfiles>> = {}) {
  return {
    profiles: [base, trustedProfile],
    total: 2,
    page: 1,
    pageSize: 10,
    isLoading: false,
    error: null,
    fetchProfiles: vi.fn().mockResolvedValue(undefined),
    createProfile: vi.fn().mockResolvedValue(undefined),
    updateProfile: vi.fn().mockResolvedValue(undefined),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
    testConnection: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

describe('ServerProfileList host keys (#60)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useServerProfiles).mockReturnValue(hook());
    vi.mocked(trustHostKey).mockResolvedValue({ ...base, fingerprint: PRESENTED });
  });

  it('shows a shield icon with text per row, never colour alone', () => {
    render(<ServerProfileList />, { wrapperOptions: { user: writer } });

    const statuses = screen.getAllByTestId('host-key-status');
    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toHaveAttribute('data-trusted', 'false');
    expect(statuses[0]).toHaveTextContent('Not trusted');
    expect(statuses[0].querySelector('svg')).not.toBeNull();
    expect(statuses[1]).toHaveAttribute('data-trusted', 'true');
    expect(statuses[1]).toHaveTextContent('Trusted');
    expect(statuses[1].querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Host key' })).toBeInTheDocument();
  });

  it('shows the probed facts under the host', () => {
    render(<ServerProfileList />, { wrapperOptions: { user: writer } });
    expect(screen.getByTestId('server-facts-summary')).toHaveTextContent('Distro X 12 · apt · tmux installed');
  });

  it('opens the host-key dialog on a refused test and tests again after trust', async () => {
    const user = userEvent.setup();
    const onTestResult = vi.fn();
    const testConnection = vi
      .fn()
      .mockResolvedValueOnce({
        success: false,
        error: 'Host key not trusted',
        code: 'HOST_KEY_UNKNOWN',
        presented: { fingerprint: PRESENTED, algorithm: 'ssh-ed25519' },
        expected: null,
      })
      .mockResolvedValueOnce({ success: true });
    vi.mocked(useServerProfiles).mockReturnValue(hook({ testConnection }));

    render(<ServerProfileList onTestResult={onTestResult} />, { wrapperOptions: { user: writer } });
    await user.click(screen.getAllByRole('button', { name: /test connection/i })[0]);

    const dialog = await screen.findByTestId('host-key-dialog');
    expect(within(dialog).getByTestId('host-key-presented')).toHaveTextContent(PRESENTED);
    expect(onTestResult).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Trust and test' }));

    expect(trustHostKey).toHaveBeenCalledWith('profile-a', PRESENTED, undefined);
    await waitFor(() => expect(testConnection).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onTestResult).toHaveBeenCalledWith({ success: true }));
  });

  it('reports the refusal when the prompt is cancelled', async () => {
    const user = userEvent.setup();
    const onTestResult = vi.fn();
    const refused = {
      success: false,
      error: 'Host key changed',
      code: 'HOST_KEY_MISMATCH',
      presented: { fingerprint: PRESENTED, algorithm: 'ssh-ed25519' },
      expected: TRUSTED,
    };
    vi.mocked(useServerProfiles).mockReturnValue(hook({ testConnection: vi.fn().mockResolvedValue(refused) }));

    render(<ServerProfileList onTestResult={onTestResult} />, { wrapperOptions: { user: writer } });
    await user.click(screen.getAllByRole('button', { name: /test connection/i })[1]);
    const dialog = await screen.findByTestId('host-key-dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(onTestResult).toHaveBeenCalledWith(refused);
    expect(trustHostKey).not.toHaveBeenCalled();
  });
});

describe('ServerProfileForm host-key section (#60)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  function renderForm(profile: ServerProfile | null, onProfileChanged = vi.fn()) {
    render(
      <ServerProfileForm
        open
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        profile={profile}
        onProfileChanged={onProfileChanged}
      />,
      { wrapperOptions: { user: writer } },
    );
    return onProfileChanged;
  }

  it('shows "—" before the profile exists', () => {
    renderForm(null);
    const section = screen.getByTestId('host-key-section-new');
    expect(within(section).getByText('—')).toBeInTheDocument();
  });

  it('shows the trusted status, fingerprint and facts', () => {
    renderForm(trustedProfile);
    const section = screen.getByTestId('host-key-section');
    expect(within(section).getByTestId('host-key-chip')).toHaveTextContent('Trusted');
    expect(within(section).getByTestId('host-key-fingerprint')).toHaveTextContent(TRUSTED);
    expect(within(section).getByText('ED25519 fingerprint')).toBeInTheDocument();
    expect(within(section).getByTestId('server-facts')).toHaveTextContent('Distro X 12 · apt · tmux installed');
  });

  it('shows "Not trusted" without a key and hides Forget', () => {
    renderForm(base);
    const section = screen.getByTestId('host-key-section');
    expect(within(section).getByTestId('host-key-chip')).toHaveTextContent('Not trusted');
    expect(within(section).queryByRole('button', { name: 'Forget' })).not.toBeInTheDocument();
    expect(within(section).getByTestId('server-facts')).toHaveTextContent('Not probed yet');
  });

  it('Scan reports a match', async () => {
    const user = userEvent.setup();
    vi.mocked(scanHostKey).mockResolvedValue({
      presented: { fingerprint: TRUSTED, algorithm: 'ssh-ed25519' },
      trusted: { fingerprint: TRUSTED, algorithm: 'ssh-ed25519', trustedAt: '2026-01-02T00:00:00.000Z' },
      matches: true,
    });
    renderForm(trustedProfile);

    await user.click(screen.getByRole('button', { name: 'Scan' }));

    expect(scanHostKey).toHaveBeenCalledWith('profile-b');
    expect(await screen.findByText('The server presents the trusted key.')).toBeInTheDocument();
  });

  it('Scan of an untrusted server opens the dialog and trusting updates the status', async () => {
    const user = userEvent.setup();
    vi.mocked(scanHostKey).mockResolvedValue({
      presented: { fingerprint: PRESENTED, algorithm: 'ssh-ed25519' },
      trusted: null,
      matches: false,
    });
    const updated = { ...base, fingerprint: PRESENTED, hostKeyAlgorithm: 'ssh-ed25519' };
    vi.mocked(trustHostKey).mockResolvedValue(updated);
    const onProfileChanged = renderForm(base);

    await user.click(screen.getByRole('button', { name: 'Scan' }));
    const dialog = await screen.findByTestId('host-key-dialog');
    expect(dialog).toHaveAttribute('data-state', 'unknown');
    await user.click(within(dialog).getByRole('button', { name: 'Trust key' }));

    await waitFor(() => expect(onProfileChanged).toHaveBeenCalledWith(updated));
    expect(screen.getByTestId('host-key-chip')).toHaveTextContent('Trusted');
  });

  it('Scan of a changed key opens the mismatch dialog', async () => {
    const user = userEvent.setup();
    vi.mocked(scanHostKey).mockResolvedValue({
      presented: { fingerprint: PRESENTED, algorithm: 'ssh-ed25519' },
      trusted: { fingerprint: TRUSTED, algorithm: 'ssh-ed25519', trustedAt: null },
      matches: false,
    });
    renderForm(trustedProfile);

    await user.click(screen.getByRole('button', { name: 'Scan' }));

    const dialog = await screen.findByTestId('host-key-dialog');
    expect(dialog).toHaveAttribute('data-state', 'mismatch');
    expect(within(dialog).getByTestId('host-key-expected')).toHaveTextContent(TRUSTED);
  });

  it('Forget clears the trusted key', async () => {
    const user = userEvent.setup();
    vi.mocked(forgetHostKey).mockResolvedValue({ ...trustedProfile, fingerprint: null, hostKeyAlgorithm: null });
    const onProfileChanged = renderForm(trustedProfile);

    await user.click(screen.getByRole('button', { name: 'Forget' }));

    expect(forgetHostKey).toHaveBeenCalledWith('profile-b');
    await waitFor(() => expect(screen.getByTestId('host-key-chip')).toHaveTextContent('Not trusted'));
    expect(onProfileChanged).toHaveBeenCalled();
  });

  it('a facts refresh refused for the host key opens the dialog', async () => {
    const user = userEvent.setup();
    vi.mocked(refreshServerFacts).mockRejectedValue(
      new ApiError('Host key not trusted', 409, 'HOST_KEY_UNKNOWN', {
        presented: { fingerprint: PRESENTED, algorithm: 'ssh-ed25519' },
        expected: null,
        serverProfileId: 'profile-a',
      }),
    );
    renderForm(base);

    await user.click(screen.getByRole('button', { name: 'Refresh server facts' }));

    expect(await screen.findByTestId('host-key-dialog')).toHaveAttribute('data-state', 'unknown');
  });

  it('warns that changing the hostname forgets the trusted key', async () => {
    const user = userEvent.setup();
    renderForm(trustedProfile);

    const hostname = screen.getByLabelText(/Hostname/);
    await user.clear(hostname);
    await user.type(hostname, 'server-c.example.test');

    expect(screen.getByText(/forgets the trusted host key/)).toBeInTheDocument();
  });
});
