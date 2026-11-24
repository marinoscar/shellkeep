import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockUser } from '../../utils/test-utils';
import { ApiError } from '../../../services/api';
import type { HostKeyRefusal, ServerProfile } from '../../../types';

vi.mock('../../../services/terminal-api', () => ({
  trustHostKey: vi.fn(),
  getServerProfile: vi.fn(),
}));

import { trustHostKey, getServerProfile } from '../../../services/terminal-api';
import {
  HostKeyDialog,
  HOST_KEY_MISMATCH_TITLE,
  HOST_KEY_UNKNOWN_TITLE,
} from '../../../components/server-profiles/HostKeyDialog';

const PRESENTED = 'SHA256:presentedKeyFingerprintAAAAAAAAAAAAAAAAAAAA';
const EXPECTED = 'SHA256:trustedKeyFingerprintBBBBBBBBBBBBBBBBBBBBBBB';
const HOSTNAME = 'server-a.example.test';

const unknown: HostKeyRefusal = {
  code: 'HOST_KEY_UNKNOWN',
  presented: { fingerprint: PRESENTED, algorithm: 'ssh-ed25519' },
  expected: null,
  serverProfileId: 'profile-a',
};
const mismatch: HostKeyRefusal = { ...unknown, code: 'HOST_KEY_MISMATCH', expected: EXPECTED };

const writer = { ...mockUser, permissions: [...mockUser.permissions, 'servers:read', 'servers:write'] };
const reader = { ...mockUser, permissions: [...mockUser.permissions, 'servers:read'] };

const trusted = { id: 'profile-a', hostname: HOSTNAME, fingerprint: PRESENTED } as ServerProfile;

describe('HostKeyDialog (#60)', () => {
  beforeEach(() => {
    vi.mocked(trustHostKey).mockReset().mockResolvedValue(trusted);
    vi.mocked(getServerProfile).mockReset().mockResolvedValue({ hostname: HOSTNAME } as ServerProfile);
  });

  it('renders nothing without a refusal', () => {
    render(<HostKeyDialog refusal={null} onTrusted={vi.fn()} onCancel={vi.fn()} />, {
      wrapperOptions: { user: writer },
    });
    expect(screen.queryByTestId('host-key-dialog')).not.toBeInTheDocument();
  });

  describe('unknown key', () => {
    it('shows the algorithm, the fingerprint and the ssh-keygen hint', () => {
      render(<HostKeyDialog refusal={unknown} hostname={HOSTNAME} onTrusted={vi.fn()} onCancel={vi.fn()} />, {
        wrapperOptions: { user: writer },
      });

      expect(screen.getByRole('alertdialog', { name: HOST_KEY_UNKNOWN_TITLE })).toBeInTheDocument();
      expect(screen.getByTestId('host-key-dialog')).toHaveAttribute('data-state', 'unknown');
      expect(screen.getByTestId('host-key-presented')).toHaveTextContent(PRESENTED);
      expect(screen.getByText(/ED25519/)).toBeInTheDocument();
      expect(screen.getByTestId('host-key-hint')).toHaveTextContent(
        'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub',
      );
      expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
      expect(screen.queryByTestId('host-key-expected')).not.toBeInTheDocument();
    });

    it('trusts exactly the presented fingerprint and reports the profile', async () => {
      const user = userEvent.setup();
      const onTrusted = vi.fn();
      render(<HostKeyDialog refusal={unknown} hostname={HOSTNAME} onTrusted={onTrusted} onCancel={vi.fn()} />, {
        wrapperOptions: { user: writer },
      });

      await user.click(screen.getByRole('button', { name: 'Trust and connect' }));

      expect(trustHostKey).toHaveBeenCalledWith('profile-a', PRESENTED, undefined);
      await waitFor(() => expect(onTrusted).toHaveBeenCalledWith(trusted));
    });

    it('cancels without trusting', async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn();
      render(<HostKeyDialog refusal={unknown} hostname={HOSTNAME} onTrusted={vi.fn()} onCancel={onCancel} />, {
        wrapperOptions: { user: writer },
      });

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onCancel).toHaveBeenCalled();
      expect(trustHostKey).not.toHaveBeenCalled();
    });

    it('shows the new key when the server key changed during trust (409)', async () => {
      const user = userEvent.setup();
      const changed = 'SHA256:changedDuringTrustCCCCCCCCCCCCCCCCCCCCCCCCCC';
      vi.mocked(trustHostKey).mockRejectedValueOnce(
        new ApiError('changed', 409, 'HOST_KEY_CHANGED_DURING_TRUST', {
          presented: { fingerprint: changed, algorithm: 'ssh-ed25519' },
          confirmed: PRESENTED,
        }),
      );
      const onTrusted = vi.fn();
      render(<HostKeyDialog refusal={unknown} hostname={HOSTNAME} onTrusted={onTrusted} onCancel={vi.fn()} />, {
        wrapperOptions: { user: writer },
      });

      await user.click(screen.getByRole('button', { name: 'Trust and connect' }));

      expect(await screen.findByText(/now presents a different key/)).toBeInTheDocument();
      expect(screen.getByTestId('host-key-presented')).toHaveTextContent(changed);
      expect(onTrusted).not.toHaveBeenCalled();
    });

    it('offers no trust button without servers:write', () => {
      render(<HostKeyDialog refusal={unknown} hostname={HOSTNAME} onTrusted={vi.fn()} onCancel={vi.fn()} />, {
        wrapperOptions: { user: reader },
      });
      expect(screen.queryByRole('button', { name: 'Trust and connect' })).not.toBeInTheDocument();
      expect(screen.getByText(/needs the servers:write permission/)).toBeInTheDocument();
    });
  });

  describe('changed key', () => {
    it('is titled as a possible interception and shows expected vs presented', () => {
      render(<HostKeyDialog refusal={mismatch} hostname={HOSTNAME} onTrusted={vi.fn()} onCancel={vi.fn()} />, {
        wrapperOptions: { user: writer },
      });

      expect(screen.getByRole('alertdialog', { name: HOST_KEY_MISMATCH_TITLE })).toBeInTheDocument();
      expect(screen.getByTestId('host-key-dialog')).toHaveAttribute('data-state', 'mismatch');
      expect(screen.getByTestId('host-key-expected')).toHaveTextContent(EXPECTED);
      expect(screen.getByTestId('host-key-presented')).toHaveTextContent(PRESENTED);
      expect(screen.getByTestId('host-key-hint')).toBeInTheDocument();
    });

    it('focuses Cancel by default', async () => {
      render(<HostKeyDialog refusal={mismatch} hostname={HOSTNAME} onTrusted={vi.fn()} onCancel={vi.fn()} />, {
        wrapperOptions: { user: writer },
      });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    });

    it('replaces the key only after the hostname is typed', async () => {
      const user = userEvent.setup();
      const onTrusted = vi.fn();
      render(<HostKeyDialog refusal={mismatch} hostname={HOSTNAME} onTrusted={onTrusted} onCancel={vi.fn()} />, {
        wrapperOptions: { user: writer },
      });

      await user.click(screen.getByRole('button', { name: 'Replace trusted key…' }));
      const confirm = await screen.findByRole('button', { name: 'Replace and connect' });
      expect(confirm).toBeDisabled();

      const field = screen.getByLabelText('Hostname');
      await user.type(field, 'server-a');
      expect(confirm).toBeDisabled();
      await user.type(field, '.example.test');
      expect(confirm).toBeEnabled();

      await user.click(confirm);

      expect(trustHostKey).toHaveBeenCalledWith('profile-a', PRESENTED, HOSTNAME);
      await waitFor(() => expect(onTrusted).toHaveBeenCalledWith(trusted));
    });

    it('fetches the hostname when the caller does not pass it', async () => {
      const user = userEvent.setup();
      render(<HostKeyDialog refusal={mismatch} onTrusted={vi.fn()} onCancel={vi.fn()} />, {
        wrapperOptions: { user: writer },
      });

      expect(getServerProfile).toHaveBeenCalledWith('profile-a');
      await user.click(await screen.findByRole('button', { name: 'Replace trusted key…' }));
      await user.type(screen.getByLabelText('Hostname'), HOSTNAME);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Replace and connect' })).toBeEnabled());
    });

    it('hides Replace without servers:write', () => {
      render(<HostKeyDialog refusal={mismatch} hostname={HOSTNAME} onTrusted={vi.fn()} onCancel={vi.fn()} />, {
        wrapperOptions: { user: reader },
      });
      expect(screen.queryByRole('button', { name: 'Replace trusted key…' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });
  });
});
