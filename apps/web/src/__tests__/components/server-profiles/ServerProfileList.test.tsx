import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { ServerProfileList } from '../../../components/server-profiles/ServerProfileList';
import type { ServerProfile, ServerProfilesResponse } from '../../../types';

// Mock the useServerProfiles hook so we can control all returned state
vi.mock('../../../hooks/useServerProfiles', () => ({
  useServerProfiles: vi.fn(),
}));

// Mock the child form component to keep list tests focused
vi.mock('../../../components/server-profiles/ServerProfileForm', () => ({
  ServerProfileForm: vi.fn(({ open, onClose, onSave, profile }) =>
    open ? (
      <div data-testid="server-profile-form">
        <span data-testid="form-mode">{profile ? 'edit' : 'create'}</span>
        <button onClick={onClose}>FormClose</button>
        <button onClick={() => onSave({ name: 'Saved', hostname: 'h', port: 22, username: 'u', authMethod: 'password' })}>
          FormSave
        </button>
      </div>
    ) : null
  ),
}));

import { useServerProfiles } from '../../../hooks/useServerProfiles';

const mockUseServerProfiles = vi.mocked(useServerProfiles);

const mockProfile1: ServerProfile = {
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
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const mockProfile2: ServerProfile = {
  id: 'profile-2',
  name: 'Staging Server',
  hostname: 'staging.example.com',
  port: 2222,
  username: 'admin',
  authMethod: 'key',
  hasPassword: false,
  hasPrivateKey: true,
  hasPassphrase: false,
  fingerprint: 'SHA256:abc123',
  tags: [],
  createdAt: '2024-01-02T00:00:00.000Z',
  updatedAt: '2024-01-02T00:00:00.000Z',
};

function buildHookDefaults(overrides: Partial<ReturnType<typeof useServerProfiles>> = {}) {
  return {
    profiles: [mockProfile1, mockProfile2],
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

describe('ServerProfileList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseServerProfiles.mockReturnValue(buildHookDefaults());
    // Mock window.confirm to avoid jsdom warnings
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  describe('Loading State', () => {
    it('should show a spinner while loading', () => {
      mockUseServerProfiles.mockReturnValue(
        buildHookDefaults({ profiles: [], isLoading: true })
      );

      render(<ServerProfileList />);

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('should not show the table while loading', () => {
      mockUseServerProfiles.mockReturnValue(
        buildHookDefaults({ profiles: [], isLoading: true })
      );

      render(<ServerProfileList />);

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should show an error alert when the hook reports an error', () => {
      mockUseServerProfiles.mockReturnValue(
        buildHookDefaults({ profiles: [], error: 'Failed to load profiles' })
      );

      render(<ServerProfileList />);

      expect(screen.getByText('Failed to load profiles')).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show default empty message when no profiles and no search', () => {
      mockUseServerProfiles.mockReturnValue(
        buildHookDefaults({ profiles: [], total: 0 })
      );

      render(<ServerProfileList />);

      expect(
        screen.getByText(/no server profiles yet/i)
      ).toBeInTheDocument();
    });

    it('should show search-specific empty message when no profiles match search', async () => {
      const user = userEvent.setup();
      mockUseServerProfiles.mockReturnValue(
        buildHookDefaults({ profiles: [], total: 0 })
      );

      render(<ServerProfileList />);

      await user.type(screen.getByLabelText(/search servers/i), 'xyz');

      await waitFor(() => {
        expect(
          screen.getByText(/no servers found matching your search/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('Profile List Rendering', () => {
    it('should render a table with the correct column headers', () => {
      render(<ServerProfileList />);

      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Host')).toBeInTheDocument();
      expect(screen.getByText('Username')).toBeInTheDocument();
      expect(screen.getByText('Auth Method')).toBeInTheDocument();
      expect(screen.getByText('Tags')).toBeInTheDocument();
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });

    it('should render each profile as a table row', () => {
      render(<ServerProfileList />);

      expect(screen.getByText('Dev Server')).toBeInTheDocument();
      expect(screen.getByText('Staging Server')).toBeInTheDocument();
    });

    it('should display hostname and port in the Host column', () => {
      render(<ServerProfileList />);

      expect(screen.getByText('dev.example.com:22')).toBeInTheDocument();
      expect(screen.getByText('staging.example.com:2222')).toBeInTheDocument();
    });

    it('should display readable auth method labels', () => {
      render(<ServerProfileList />);

      expect(screen.getByText('Password')).toBeInTheDocument();
      expect(screen.getByText('SSH Key')).toBeInTheDocument();
    });

    it('should render tags as chips', () => {
      render(<ServerProfileList />);

      expect(screen.getByText('dev')).toBeInTheDocument();
      expect(screen.getByText('linux')).toBeInTheDocument();
    });

    it('should show dash placeholder when a profile has no tags', () => {
      render(<ServerProfileList />);

      // mockProfile2 has no tags; it renders a dash
      const rows = screen.getAllByRole('row');
      const stagingRow = rows.find((r) => within(r).queryByText('Staging Server'));
      expect(stagingRow).toBeDefined();
      expect(within(stagingRow!).getByText('-')).toBeInTheDocument();
    });

    it('should render edit, test connection, and delete buttons for each profile', () => {
      render(<ServerProfileList />);

      // There should be 2 rows of action buttons
      const editButtons = screen.getAllByLabelText(/edit/i);
      const testButtons = screen.getAllByLabelText(/test connection/i);
      const deleteButtons = screen.getAllByLabelText(/delete/i);

      expect(editButtons).toHaveLength(2);
      expect(testButtons).toHaveLength(2);
      expect(deleteButtons).toHaveLength(2);
    });
  });

  describe('Search', () => {
    it('should render the search input', () => {
      render(<ServerProfileList />);

      expect(screen.getByLabelText(/search servers/i)).toBeInTheDocument();
    });

    it('should call fetchProfiles with search term when typing', async () => {
      const user = userEvent.setup();
      const fetchProfiles = vi.fn().mockResolvedValue(undefined);
      mockUseServerProfiles.mockReturnValue(buildHookDefaults({ fetchProfiles }));

      render(<ServerProfileList />);

      await user.type(screen.getByLabelText(/search servers/i), 'dev');

      await waitFor(() => {
        expect(fetchProfiles).toHaveBeenCalledWith(
          expect.objectContaining({ search: 'dev' })
        );
      });
    });
  });

  describe('Add Server Button', () => {
    it('should render the "Add Server" button', () => {
      render(<ServerProfileList />);

      expect(screen.getByRole('button', { name: /add server/i })).toBeInTheDocument();
    });

    it('should open the form in create mode when clicking "Add Server"', async () => {
      const user = userEvent.setup();

      render(<ServerProfileList />);

      await user.click(screen.getByRole('button', { name: /add server/i }));

      await waitFor(() => {
        expect(screen.getByTestId('server-profile-form')).toBeInTheDocument();
        expect(screen.getByTestId('form-mode')).toHaveTextContent('create');
      });
    });
  });

  describe('Edit Action', () => {
    it('should open the form in edit mode when clicking the edit icon for a profile', async () => {
      const user = userEvent.setup();

      render(<ServerProfileList />);

      const editButtons = screen.getAllByLabelText(/edit/i);
      await user.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByTestId('server-profile-form')).toBeInTheDocument();
        expect(screen.getByTestId('form-mode')).toHaveTextContent('edit');
      });
    });

    it('should call updateProfile when saving the form in edit mode', async () => {
      const user = userEvent.setup();
      const updateProfile = vi.fn().mockResolvedValue(undefined);
      mockUseServerProfiles.mockReturnValue(buildHookDefaults({ updateProfile }));

      render(<ServerProfileList />);

      const editButtons = screen.getAllByLabelText(/edit/i);
      await user.click(editButtons[0]);

      await user.click(screen.getByText('FormSave'));

      await waitFor(() => {
        expect(updateProfile).toHaveBeenCalledWith(
          mockProfile1.id,
          expect.objectContaining({ name: 'Saved' })
        );
      });
    });
  });

  describe('Delete Action', () => {
    it('should call deleteProfile when confirming delete', async () => {
      const user = userEvent.setup();
      const deleteProfile = vi.fn().mockResolvedValue(undefined);
      mockUseServerProfiles.mockReturnValue(buildHookDefaults({ deleteProfile }));

      render(<ServerProfileList />);

      const deleteButtons = screen.getAllByLabelText(/delete/i);
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(deleteProfile).toHaveBeenCalledWith(mockProfile1.id);
      });
    });

    it('should not call deleteProfile when confirm is cancelled', async () => {
      const user = userEvent.setup();
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const deleteProfile = vi.fn().mockResolvedValue(undefined);
      mockUseServerProfiles.mockReturnValue(buildHookDefaults({ deleteProfile }));

      render(<ServerProfileList />);

      const deleteButtons = screen.getAllByLabelText(/delete/i);
      await user.click(deleteButtons[0]);

      expect(deleteProfile).not.toHaveBeenCalled();
    });

    it('should call onDeleteSuccess callback after successful delete', async () => {
      const user = userEvent.setup();
      const onDeleteSuccess = vi.fn();
      const deleteProfile = vi.fn().mockResolvedValue(undefined);
      mockUseServerProfiles.mockReturnValue(buildHookDefaults({ deleteProfile }));

      render(<ServerProfileList onDeleteSuccess={onDeleteSuccess} />);

      const deleteButtons = screen.getAllByLabelText(/delete/i);
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(onDeleteSuccess).toHaveBeenCalled();
      });
    });

    it('should call onError callback when delete fails', async () => {
      const user = userEvent.setup();
      const onError = vi.fn();
      const deleteProfile = vi.fn().mockRejectedValue(new Error('Delete failed'));
      mockUseServerProfiles.mockReturnValue(buildHookDefaults({ deleteProfile }));

      render(<ServerProfileList onError={onError} />);

      const deleteButtons = screen.getAllByLabelText(/delete/i);
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('Delete failed');
      });
    });

    it('should call onError with fallback message when delete fails with non-Error', async () => {
      const user = userEvent.setup();
      const onError = vi.fn();
      const deleteProfile = vi.fn().mockRejectedValue('oops');
      mockUseServerProfiles.mockReturnValue(buildHookDefaults({ deleteProfile }));

      render(<ServerProfileList onError={onError} />);

      const deleteButtons = screen.getAllByLabelText(/delete/i);
      await user.click(deleteButtons[0]);

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('Failed to delete profile');
      });
    });
  });

  describe('Test Connection Action', () => {
    it('should call testConnection for the correct profile when clicking test button', async () => {
      const user = userEvent.setup();
      const testConnection = vi.fn().mockResolvedValue({ success: true });
      mockUseServerProfiles.mockReturnValue(buildHookDefaults({ testConnection }));

      render(<ServerProfileList />);

      // The TestIcon (NetworkCheck) SVG has data-testid="NetworkCheckIcon"
      const testIcons = screen.getAllByTestId('NetworkCheckIcon');
      await user.click(testIcons[0].closest('button')!);

      await waitFor(() => {
        expect(testConnection).toHaveBeenCalledWith(mockProfile1.id);
      });
    });

    it('should call onTestResult with success result when test passes', async () => {
      const user = userEvent.setup();
      const onTestResult = vi.fn();
      const testConnection = vi.fn().mockResolvedValue({ success: true });
      mockUseServerProfiles.mockReturnValue(buildHookDefaults({ testConnection }));

      render(<ServerProfileList onTestResult={onTestResult} />);

      const testIcons = screen.getAllByTestId('NetworkCheckIcon');
      await user.click(testIcons[0].closest('button')!);

      await waitFor(() => {
        expect(onTestResult).toHaveBeenCalledWith({ success: true });
      });
    });

    it('should call onTestResult with failure result when test fails', async () => {
      const user = userEvent.setup();
      const onTestResult = vi.fn();
      const testConnection = vi.fn().mockResolvedValue({
        success: false,
        error: 'Connection refused',
      });
      mockUseServerProfiles.mockReturnValue(buildHookDefaults({ testConnection }));

      render(<ServerProfileList onTestResult={onTestResult} />);

      const testIcons = screen.getAllByTestId('NetworkCheckIcon');
      await user.click(testIcons[0].closest('button')!);

      await waitFor(() => {
        expect(onTestResult).toHaveBeenCalledWith({
          success: false,
          error: 'Connection refused',
        });
      });
    });

    it('should disable the test button for the profile being tested', async () => {
      const user = userEvent.setup();
      let resolveTest!: (val: { success: boolean }) => void;
      const testConnection = vi.fn().mockReturnValue(
        new Promise<{ success: boolean }>((resolve) => {
          resolveTest = resolve;
        })
      );
      mockUseServerProfiles.mockReturnValue(buildHookDefaults({ testConnection }));

      render(<ServerProfileList />);

      const testIcons = screen.getAllByTestId('NetworkCheckIcon');
      await user.click(testIcons[0].closest('button')!);

      await waitFor(() => {
        // While testing, a CircularProgress replaces the icon (disabled state)
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
      });

      await act(async () => {
        resolveTest({ success: true });
      });
    });
  });

  describe('Pagination', () => {
    it('should render pagination controls when profiles exist', () => {
      mockUseServerProfiles.mockReturnValue(
        buildHookDefaults({ total: 25 })
      );

      render(<ServerProfileList />);

      // MUI TablePagination renders a combobox for rows per page and navigation buttons
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('should call fetchProfiles with updated page when page changes', async () => {
      const user = userEvent.setup();
      const fetchProfiles = vi.fn().mockResolvedValue(undefined);
      mockUseServerProfiles.mockReturnValue(
        buildHookDefaults({ fetchProfiles, total: 25 })
      );

      render(<ServerProfileList />);

      const nextPageButton = screen.getByLabelText(/go to next page/i);
      await user.click(nextPageButton);

      await waitFor(() => {
        expect(fetchProfiles).toHaveBeenCalledWith(
          expect.objectContaining({ page: 2 })
        );
      });
    });
  });

  describe('Create Profile via Form', () => {
    it('should call createProfile when saving the form in create mode', async () => {
      const user = userEvent.setup();
      const createProfile = vi.fn().mockResolvedValue(undefined);
      mockUseServerProfiles.mockReturnValue(buildHookDefaults({ createProfile }));

      render(<ServerProfileList />);

      await user.click(screen.getByRole('button', { name: /add server/i }));
      await user.click(screen.getByText('FormSave'));

      await waitFor(() => {
        expect(createProfile).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'Saved' })
        );
      });
    });
  });
});
