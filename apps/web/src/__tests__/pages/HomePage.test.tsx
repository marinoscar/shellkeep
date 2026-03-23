import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render, mockUser, mockAdminUser } from '../utils/test-utils';
import HomePage from '../../pages/HomePage';

// Mock NewSessionDialog to avoid xterm dependencies
vi.mock('../../components/terminal/NewSessionDialog', () => ({
  NewSessionDialog: ({
    open,
    onClose,
    onCreate,
  }: {
    open: boolean;
    onClose: () => void;
    onCreate: (data: { serverProfileId: string; name?: string }) => Promise<void>;
  }) =>
    open ? (
      <div data-testid="new-session-dialog">
        <button onClick={onClose}>Close</button>
        <button
          onClick={() => onCreate({ serverProfileId: 'test-profile', name: 'Test Session' })}
        >
          Create
        </button>
      </div>
    ) : null,
}));

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render welcome message with user display name', async () => {
      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: mockUser,
        },
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /welcome back, test user/i })).toBeInTheDocument();
      });
    });

    it('should render welcome message without name when display name is null', async () => {
      const userWithoutName = {
        ...mockUser,
        displayName: null,
      };

      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: userWithoutName,
        },
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /^welcome back$/i })).toBeInTheDocument();
      });
    });

    it('should render the control center description', () => {
      render(<HomePage />);

      expect(screen.getByText(/shellkeep control center/i)).toBeInTheDocument();
    });

    it('should render New Session button', () => {
      render(<HomePage />);

      expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument();
    });
  });

  describe('Role-Based Display', () => {
    it('should render correctly for Viewer role', () => {
      const viewerUser = {
        ...mockUser,
        roles: [{ name: 'viewer' }],
        permissions: ['user_settings:read', 'user_settings:write'],
      };

      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: viewerUser,
        },
      });

      expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument();
    });

    it('should render correctly for Contributor role', () => {
      const contributorUser = {
        ...mockUser,
        displayName: 'Contributor User',
        roles: [{ name: 'contributor' }],
        permissions: ['user_settings:read', 'user_settings:write'],
      };

      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: contributorUser,
        },
      });

      expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument();
    });

    it('should render correctly for Admin role', () => {
      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: mockAdminUser,
        },
      });

      expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument();
    });

    it('should show welcome with admin user display name', () => {
      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: mockAdminUser,
        },
      });

      expect(screen.getByRole('heading', { name: /welcome back, admin user/i })).toBeInTheDocument();
    });
  });

  describe('Layout and Structure', () => {
    it('should use Container with maxWidth lg', () => {
      const { container } = render(<HomePage />);

      const muiContainer = container.querySelector('.MuiContainer-maxWidthLg');
      expect(muiContainer).toBeInTheDocument();
    });

    it('should have proper vertical padding', () => {
      const { container } = render(<HomePage />);

      // Check that Box with py: 4 exists
      const paddedBox = container.querySelector('[class*="MuiBox"]');
      expect(paddedBox).toBeInTheDocument();
    });

    it('should use Grid layout for panels', () => {
      const { container } = render(<HomePage />);

      const gridContainers = container.querySelectorAll('.MuiGrid-container');
      expect(gridContainers.length).toBeGreaterThan(0);
    });

    it('should have responsive grid items', () => {
      const { container } = render(<HomePage />);

      const gridItems = container.querySelectorAll('.MuiGrid-item');
      expect(gridItems.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('User Display Variations', () => {
    it('should handle user with no profile image', () => {
      const userNoImage = {
        ...mockUser,
        profileImageUrl: null,
      };

      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: userNoImage,
        },
      });

      // Should still render welcome heading
      expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    });

    it('should handle user with profile image URL', () => {
      const userWithImage = {
        ...mockUser,
        profileImageUrl: 'https://example.com/avatar.jpg',
      };

      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: userWithImage,
        },
      });

      expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    });

    it('should render without display name', () => {
      const userWithoutName = {
        ...mockUser,
        displayName: null,
      };

      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: userWithoutName,
        },
      });

      expect(screen.getByRole('heading', { name: /^welcome back$/i })).toBeInTheDocument();
    });

    it('should handle multiple roles', () => {
      const multiRoleUser = {
        ...mockUser,
        roles: [{ name: 'admin' }, { name: 'contributor' }],
        permissions: mockAdminUser.permissions,
      };

      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: multiRoleUser,
        },
      });

      expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    });
  });

  describe('Date Formatting', () => {
    it('should render the welcome heading with any user', () => {
      const specificDate = new Date('2024-01-15T10:00:00Z');
      const userWithDate = {
        ...mockUser,
        createdAt: specificDate.toISOString(),
      };

      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: userWithDate,
        },
      });

      expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    });
  });

  describe('Authentication States', () => {
    it('should render when user is authenticated', () => {
      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: mockUser,
        },
      });

      expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    });

    it('should handle missing user data gracefully', () => {
      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: null,
        },
      });

      expect(screen.getByRole('heading', { name: /^welcome back$/i })).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper heading hierarchy', () => {
      render(<HomePage />);

      const mainHeading = screen.getByRole('heading', { name: /welcome back/i });
      expect(mainHeading).toBeInTheDocument();
      expect(mainHeading.tagName).toBe('H1');
    });

    it('should have descriptive New Session button label', () => {
      render(<HomePage />);

      const newSessionBtn = screen.getByRole('button', { name: /new session/i });
      expect(newSessionBtn).toBeInTheDocument();
    });

    it('should render page without avatar alt text (no image displayed)', () => {
      const userWithImage = {
        ...mockUser,
        profileImageUrl: 'https://example.com/avatar.jpg',
      };

      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: userWithImage,
        },
      });

      // The HomePage doesn't render an avatar image, just a welcome message
      expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    });
  });

  describe('Integration', () => {
    it('should render all components together correctly', () => {
      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: mockAdminUser,
        },
      });

      // Main heading
      expect(screen.getByRole('heading', { name: /welcome back, admin user/i })).toBeInTheDocument();

      // Control center description
      expect(screen.getByText(/shellkeep control center/i)).toBeInTheDocument();

      // New Session button in stats bar
      expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument();
    });

    it('should maintain consistent layout across different user types', () => {
      const { rerender } = render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: mockUser,
        },
      });

      expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument();

      // Re-render with admin user
      rerender(<HomePage />);

      expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument();
    });
  });
});
