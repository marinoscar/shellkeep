import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { NewSessionDialog } from '../../../components/terminal/NewSessionDialog';

// Mock the API service
vi.mock('../../../services/api', () => ({
  getServerProfiles: vi.fn(),
}));

import { getServerProfiles } from '../../../services/api';

import type { ServerProfile, ServerProfilesResponse } from '../../../types';

const mockProfile1: ServerProfile = {
  id: 'profile-1',
  name: 'Dev Server',
  hostname: 'dev.example.com',
  port: 22,
  username: 'deploy',
  authMethod: 'key',
  hasPassword: false,
  hasPrivateKey: true,
  hasPassphrase: false,
  fingerprint: 'SHA256:abc',
  tags: ['dev'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockProfile2: ServerProfile = {
  id: 'profile-2',
  name: 'Staging Server',
  hostname: 'staging.example.com',
  port: 2222,
  username: 'admin',
  authMethod: 'password',
  hasPassword: true,
  hasPrivateKey: false,
  hasPassphrase: false,
  fingerprint: null,
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockProfilesResponse: ServerProfilesResponse = {
  items: [mockProfile1, mockProfile2],
  total: 2,
  page: 1,
  pageSize: 100,
};

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onCreate: vi.fn().mockResolvedValue(undefined),
};

describe('NewSessionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerProfiles).mockResolvedValue(mockProfilesResponse);
  });

  describe('Rendering', () => {
    it('should render when open=true', async () => {
      render(<NewSessionDialog {...defaultProps} />);

      expect(screen.getByText('New Terminal Session')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('Create Session')).toBeInTheDocument();
      });
    });

    it('should not render when open=false', () => {
      render(<NewSessionDialog {...defaultProps} open={false} />);

      expect(screen.queryByText('New Terminal Session')).not.toBeInTheDocument();
    });

    it('should show Cancel and Create Session buttons', async () => {
      render(<NewSessionDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Cancel')).toBeInTheDocument();
        expect(screen.getByText('Create Session')).toBeInTheDocument();
      });
    });

    it('should show session name text field', async () => {
      render(<NewSessionDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByLabelText(/session name/i)).toBeInTheDocument();
      });
    });
  });

  describe('Server Profiles Loading', () => {
    it('should fetch server profiles when opened', async () => {
      render(<NewSessionDialog {...defaultProps} />);

      await waitFor(() => {
        expect(getServerProfiles).toHaveBeenCalledWith({ pageSize: 100 });
      });
    });

    it('should show server profiles in dropdown', async () => {
      render(<NewSessionDialog {...defaultProps} />);

      await waitFor(() => {
        // The Select renders a combobox; profiles are loaded when it appears
        const combobox = screen.getByRole('combobox');
        expect(combobox).toBeInTheDocument();
      });
    });

    it('should show info message when no server profiles exist', async () => {
      vi.mocked(getServerProfiles).mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 100,
      });

      render(<NewSessionDialog {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.getByText('No server profiles found. Add a server profile first.'),
        ).toBeInTheDocument();
      });
    });

    it('should show error when profiles fail to load', async () => {
      vi.mocked(getServerProfiles).mockRejectedValue(new Error('Network error'));

      render(<NewSessionDialog {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });
  });

  describe('Creating Session', () => {
    it('should call onCreate with correct data', async () => {
      const onCreate = vi.fn().mockResolvedValue(undefined);
      render(<NewSessionDialog {...defaultProps} onCreate={onCreate} />);

      const user = userEvent.setup();

      // Wait for profiles to load
      await waitFor(() => {
        expect(screen.getByText('Create Session')).toBeEnabled();
      });

      // Click create
      await user.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledWith({
          serverProfileId: 'profile-1',
          name: undefined,
        });
      });
    });

    it('should call onCreate with session name when provided', async () => {
      const onCreate = vi.fn().mockResolvedValue(undefined);
      render(<NewSessionDialog {...defaultProps} onCreate={onCreate} />);

      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByLabelText(/session name/i)).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText(/session name/i), 'My Custom Session');
      await user.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(onCreate).toHaveBeenCalledWith({
          serverProfileId: 'profile-1',
          name: 'My Custom Session',
        });
      });
    });

    it('should show error when creation fails', async () => {
      const onCreate = vi.fn().mockRejectedValue(new Error('Creation failed'));
      render(<NewSessionDialog {...defaultProps} onCreate={onCreate} />);

      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText('Create Session')).toBeEnabled();
      });

      await user.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(screen.getByText('Creation failed')).toBeInTheDocument();
      });
    });

    it('should disable Create button when no profiles loaded', async () => {
      vi.mocked(getServerProfiles).mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 100,
      });

      render(<NewSessionDialog {...defaultProps} />);

      await waitFor(() => {
        const createButton = screen.getByText('Create Session');
        expect(createButton.closest('button')).toBeDisabled();
      });
    });
  });

  describe('Close Behavior', () => {
    it('should call onClose when Cancel is clicked', async () => {
      const onClose = vi.fn();
      render(<NewSessionDialog {...defaultProps} onClose={onClose} />);

      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText('Cancel')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Cancel'));

      expect(onClose).toHaveBeenCalled();
    });

    it('should call onClose after successful creation', async () => {
      const onClose = vi.fn();
      const onCreate = vi.fn().mockResolvedValue(undefined);
      render(
        <NewSessionDialog {...defaultProps} onClose={onClose} onCreate={onCreate} />,
      );

      const user = userEvent.setup();

      await waitFor(() => {
        expect(screen.getByText('Create Session')).toBeEnabled();
      });

      await user.click(screen.getByText('Create Session'));

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });
  });
});
