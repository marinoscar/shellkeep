import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { ServerProfileForm } from '../../../components/server-profiles/ServerProfileForm';
import type { ServerProfile, ServerProfileFormData } from '../../../types';

const mockProfile: ServerProfile = {
  id: 'profile-1',
  name: 'Dev Server',
  hostname: 'dev.example.com',
  port: 22,
  username: 'deploy',
  authMethod: 'password',
  hasPassword: true,
  hasPrivateKey: false,
  hasPassphrase: false,
  fingerprint: null,
  tags: ['dev', 'linux'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockKeyProfile: ServerProfile = {
  ...mockProfile,
  id: 'profile-2',
  name: 'Key Server',
  authMethod: 'key',
  hasPassword: false,
  hasPrivateKey: true,
  hasPassphrase: true,
};

describe('ServerProfileForm', () => {
  let mockOnClose: ReturnType<typeof vi.fn>;
  let mockOnSave: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnClose = vi.fn();
    mockOnSave = vi.fn().mockResolvedValue(undefined);
  });

  describe('Rendering - Create Mode', () => {
    it('should render dialog with "Add Server Profile" title when no profile is provided', () => {
      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByText('Add Server Profile')).toBeInTheDocument();
    });

    it('should render all base form fields', () => {
      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByLabelText(/^name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^hostname/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^port/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^username/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/tags/i)).toBeInTheDocument();
    });

    it('should default port to 22', () => {
      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByLabelText(/^port/i)).toHaveValue(22);
    });

    it('should render "Create" button in create mode', () => {
      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument();
    });

    it('should render "Cancel" button', () => {
      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('should show password field when auth method is password (default)', () => {
      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    });

    it('should not render the dialog when open is false', () => {
      render(
        <ServerProfileForm
          open={false}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.queryByText('Add Server Profile')).not.toBeInTheDocument();
    });
  });

  describe('Rendering - Edit Mode', () => {
    it('should render "Edit Server Profile" title when a profile is provided', () => {
      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          profile={mockProfile}
        />
      );

      expect(screen.getByText('Edit Server Profile')).toBeInTheDocument();
    });

    it('should populate form fields from the provided profile', () => {
      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          profile={mockProfile}
        />
      );

      expect(screen.getByLabelText(/^name/i)).toHaveValue('Dev Server');
      expect(screen.getByLabelText(/^hostname/i)).toHaveValue('dev.example.com');
      expect(screen.getByLabelText(/^port/i)).toHaveValue(22);
      expect(screen.getByLabelText(/^username/i)).toHaveValue('deploy');
    });

    it('should populate tags as comma-separated string', () => {
      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          profile={mockProfile}
        />
      );

      expect(screen.getByLabelText(/tags/i)).toHaveValue('dev, linux');
    });

    it('should render "Update" button in edit mode', () => {
      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          profile={mockProfile}
        />
      );

      expect(screen.getByRole('button', { name: /^update$/i })).toBeInTheDocument();
    });

    it('should show helper text for existing password when editing with hasPassword true', () => {
      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          profile={mockProfile}
        />
      );

      expect(screen.getByText(/leave empty to keep current password/i)).toBeInTheDocument();
    });
  });

  describe('Auth Method Toggle', () => {
    it('should show private key and passphrase fields when auth method is "key"', async () => {
      const user = userEvent.setup();

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      // Open the auth method select
      const authSelect = screen.getByLabelText(/auth method/i);
      await user.click(authSelect);

      // Select SSH Key option
      const sshKeyOption = await screen.findByRole('option', { name: /ssh key/i });
      await user.click(sshKeyOption);

      await waitFor(() => {
        expect(screen.getByLabelText(/private key/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/passphrase/i)).toBeInTheDocument();
      });
    });

    it('should hide password field when switching to "key" auth method', async () => {
      const user = userEvent.setup();

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      // Password field visible initially
      expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();

      const authSelect = screen.getByLabelText(/auth method/i);
      await user.click(authSelect);

      const sshKeyOption = await screen.findByRole('option', { name: /ssh key/i });
      await user.click(sshKeyOption);

      await waitFor(() => {
        expect(screen.queryByLabelText(/^password/i)).not.toBeInTheDocument();
      });
    });

    it('should hide both password and key fields when switching to "agent" auth method', async () => {
      const user = userEvent.setup();

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      const authSelect = screen.getByLabelText(/auth method/i);
      await user.click(authSelect);

      const agentOption = await screen.findByRole('option', { name: /ssh agent/i });
      await user.click(agentOption);

      await waitFor(() => {
        expect(screen.queryByLabelText(/^password/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/private key/i)).not.toBeInTheDocument();
      });
    });

    it('should show helper text for existing private key in edit mode with key auth', () => {
      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          profile={mockKeyProfile}
        />
      );

      expect(screen.getByText(/leave empty to keep current key/i)).toBeInTheDocument();
    });

    it('should show helper text for existing passphrase in edit mode with key auth', () => {
      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          profile={mockKeyProfile}
        />
      );

      expect(screen.getByText(/leave empty to keep current passphrase/i)).toBeInTheDocument();
    });
  });

  describe('Validation', () => {
    it('should show error when name is empty on submit', async () => {
      const user = userEvent.setup();

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(screen.getByText('Name is required')).toBeInTheDocument();
      });

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should show error when hostname is empty on submit', async () => {
      const user = userEvent.setup();

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/^name/i), 'My Server');
      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(screen.getByText('Hostname is required')).toBeInTheDocument();
      });

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should show error when username is empty on submit', async () => {
      const user = userEvent.setup();

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/^name/i), 'My Server');
      await user.type(screen.getByLabelText(/^hostname/i), 'example.com');
      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(screen.getByText('Username is required')).toBeInTheDocument();
      });

      expect(mockOnSave).not.toHaveBeenCalled();
    });

    it('should clear error message when form is valid on next submit', async () => {
      const user = userEvent.setup();

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      // Trigger validation error
      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(screen.getByText('Name is required')).toBeInTheDocument();
      });

      // Fill in all required fields
      await user.type(screen.getByLabelText(/^name/i), 'My Server');
      await user.type(screen.getByLabelText(/^hostname/i), 'example.com');
      await user.type(screen.getByLabelText(/^username/i), 'root');
      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(screen.queryByText('Name is required')).not.toBeInTheDocument();
      });
    });
  });

  describe('Form Submission', () => {
    it('should call onSave with correct data on valid create submission', async () => {
      const user = userEvent.setup();

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/^name/i), 'My Server');
      await user.type(screen.getByLabelText(/^hostname/i), 'example.com');
      await user.type(screen.getByLabelText(/^username/i), 'admin');
      await user.type(screen.getByLabelText(/^password/i), 'secret123');

      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'My Server',
            hostname: 'example.com',
            port: 22,
            username: 'admin',
            authMethod: 'password',
            password: 'secret123',
          })
        );
      });
    });

    it('should call onSave with tags array parsed from comma-separated input', async () => {
      const user = userEvent.setup();

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/^name/i), 'Tagged Server');
      await user.type(screen.getByLabelText(/^hostname/i), 'tagged.example.com');
      await user.type(screen.getByLabelText(/^username/i), 'root');
      await user.type(screen.getByLabelText(/tags/i), 'prod, web, database');

      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            tags: ['prod', 'web', 'database'],
          })
        );
      });
    });

    it('should call onClose after successful save', async () => {
      const user = userEvent.setup();

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/^name/i), 'My Server');
      await user.type(screen.getByLabelText(/^hostname/i), 'example.com');
      await user.type(screen.getByLabelText(/^username/i), 'root');

      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it('should show error message when onSave rejects', async () => {
      const user = userEvent.setup();
      mockOnSave.mockRejectedValue(new Error('Server error'));

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/^name/i), 'My Server');
      await user.type(screen.getByLabelText(/^hostname/i), 'example.com');
      await user.type(screen.getByLabelText(/^username/i), 'root');

      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(screen.getByText('Server error')).toBeInTheDocument();
      });

      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('should show fallback error message when onSave rejects with non-Error', async () => {
      const user = userEvent.setup();
      mockOnSave.mockRejectedValue('something went wrong');

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/^name/i), 'My Server');
      await user.type(screen.getByLabelText(/^hostname/i), 'example.com');
      await user.type(screen.getByLabelText(/^username/i), 'root');

      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(screen.getByText('Failed to save profile')).toBeInTheDocument();
      });
    });

    it('should show "Saving..." on submit button while submitting', async () => {
      const user = userEvent.setup();
      let resolveSave!: () => void;
      mockOnSave.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
      );

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/^name/i), 'My Server');
      await user.type(screen.getByLabelText(/^hostname/i), 'example.com');
      await user.type(screen.getByLabelText(/^username/i), 'root');

      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /saving/i })).toBeInTheDocument();
      });

      resolveSave();
    });

    it('should not call onClose when Cancel is clicked while submitting', async () => {
      const user = userEvent.setup();
      let resolveSave!: () => void;
      mockOnSave.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
      );

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.type(screen.getByLabelText(/^name/i), 'My Server');
      await user.type(screen.getByLabelText(/^hostname/i), 'example.com');
      await user.type(screen.getByLabelText(/^username/i), 'root');

      await user.click(screen.getByRole('button', { name: /^create$/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /saving/i })).toBeInTheDocument();
      });

      // Attempt to cancel while submitting
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      // onClose should not have been called (isSubmitting guard)
      expect(mockOnClose).not.toHaveBeenCalled();

      resolveSave();
    });

    it('should not include password in onSave payload when editing without changing password', async () => {
      const user = userEvent.setup();

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          profile={mockProfile}
        />
      );

      // Submit without touching the password field
      await user.click(screen.getByRole('button', { name: /^update$/i }));

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalled();
      });

      const callArg = mockOnSave.mock.calls[0][0] as ServerProfileFormData;
      expect(callArg.password).toBeUndefined();
    });

    it('should include password in onSave payload when editing and password is changed', async () => {
      const user = userEvent.setup();

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          profile={mockProfile}
        />
      );

      await user.type(screen.getByLabelText(/^password/i), 'newpassword');
      await user.click(screen.getByRole('button', { name: /^update$/i }));

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({ password: 'newpassword' })
        );
      });
    });
  });

  describe('Cancel Behavior', () => {
    it('should call onClose when Cancel is clicked', async () => {
      const user = userEvent.setup();

      render(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('Form Reset on Reopen', () => {
    it('should reset fields to empty when reopened without a profile', () => {
      const { rerender } = render(
        <ServerProfileForm
          open={false}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      // Open with a profile
      rerender(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
          profile={mockProfile}
        />
      );

      expect(screen.getByLabelText(/^name/i)).toHaveValue('Dev Server');

      // Close then reopen without a profile
      rerender(
        <ServerProfileForm
          open={false}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );
      rerender(
        <ServerProfileForm
          open={true}
          onClose={mockOnClose}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByLabelText(/^name/i)).toHaveValue('');
    });
  });
});
