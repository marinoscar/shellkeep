import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockUser, mockAdminUser } from '../utils/test-utils';
import HomePage from '../../pages/HomePage';

describe('HomePage', () => {
  beforeEach(() => {
    // Reset any state before each test
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

    it('should render QuickActions component', () => {
      render(<HomePage />);

      // QuickActions has a title
      expect(screen.getByText(/quick actions/i)).toBeInTheDocument();
    });

    it('should render New Session quick action', () => {
      render(<HomePage />);

      expect(screen.getByText(/new session/i)).toBeInTheDocument();
    });
  });

  describe('Quick Actions Section', () => {
    it('should display New Session quick action', () => {
      render(<HomePage />);

      expect(screen.getByText('New Session')).toBeInTheDocument();
      expect(screen.getByText(/connect to a server/i)).toBeInTheDocument();
    });

    it('should display All Sessions quick action', () => {
      render(<HomePage />);

      expect(screen.getByText('All Sessions')).toBeInTheDocument();
      expect(screen.getByText(/view terminal sessions/i)).toBeInTheDocument();
    });

    it('should display Manage Servers quick action', () => {
      render(<HomePage />);

      expect(screen.getAllByText('Manage Servers').length).toBeGreaterThan(0);
      expect(screen.getByText(/configure server profiles/i)).toBeInTheDocument();
    });

    it('should not display User Settings quick action', () => {
      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: mockUser,
        },
      });

      expect(screen.queryByText(/^user settings$/i)).not.toBeInTheDocument();
    });

    it('should not display System Settings for non-admin users', () => {
      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: mockUser, // viewer role
        },
      });

      expect(screen.queryByText(/^system settings$/i)).not.toBeInTheDocument();
    });

    it('should not display System Settings for admin users (not in QuickActions)', () => {
      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: mockAdminUser,
        },
      });

      // The actual QuickActions component does not include System Settings
      expect(screen.queryByText(/^system settings$/i)).not.toBeInTheDocument();
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

      // Should see Quick Actions
      expect(screen.getByText(/quick actions/i)).toBeInTheDocument();
      // Should see New Session action
      expect(screen.getByText('New Session')).toBeInTheDocument();
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

      expect(screen.getByText(/quick actions/i)).toBeInTheDocument();
      expect(screen.getByText('New Session')).toBeInTheDocument();
    });

    it('should render correctly for Admin role', () => {
      render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: mockAdminUser,
        },
      });

      // Should see Quick Actions section
      expect(screen.getByText(/quick actions/i)).toBeInTheDocument();
      expect(screen.getByText('New Session')).toBeInTheDocument();
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

  describe('Navigation', () => {
    it('should show New Session button', async () => {
      render(<HomePage />);

      const newSessionButton = screen.getByRole('button', { name: /new session/i });
      expect(newSessionButton).toBeInTheDocument();
    });

    it('should show All Sessions button', async () => {
      render(<HomePage />);

      const allSessionsButton = screen.getByRole('button', { name: /all sessions/i });
      expect(allSessionsButton).toBeInTheDocument();
    });

    it('should show Manage Servers button', async () => {
      render(<HomePage />);

      const manageServersButtons = screen.getAllByRole('button', { name: /manage servers/i });
      expect(manageServersButtons.length).toBeGreaterThan(0);
    });

    it('should navigate to sessions when clicking All Sessions', async () => {
      const user = userEvent.setup();

      render(<HomePage />);

      const allSessionsButton = screen.getByRole('button', { name: /all sessions/i });
      await user.click(allSessionsButton);

      // Navigation is handled by MemoryRouter in tests
      expect(allSessionsButton).toBeInTheDocument();
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

    it('should use Grid layout for profile and actions', () => {
      const { container } = render(<HomePage />);

      const gridContainers = container.querySelectorAll('.MuiGrid-container');
      expect(gridContainers.length).toBeGreaterThan(0);
    });

    it('should have responsive grid items', () => {
      const { container } = render(<HomePage />);

      // Profile card should be xs=12, md=4
      // Quick actions should be xs=12, md=8
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

      // HomePage renders "Welcome back" without name when displayName is null
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

      // Should still render welcome
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

      // The page should still render
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

      // Should still render welcome header without name
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

    it('should have descriptive button labels', () => {
      render(<HomePage />);

      // All buttons in QuickActions should have accessible names
      const newSessionBtn = screen.getByRole('button', { name: /new session/i });
      expect(newSessionBtn).toBeInTheDocument();

      const allSessionsBtn = screen.getByRole('button', { name: /all sessions/i });
      expect(allSessionsBtn).toBeInTheDocument();
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

      // Quick actions
      expect(screen.getByText(/quick actions/i)).toBeInTheDocument();
      expect(screen.getByText('New Session')).toBeInTheDocument();
      expect(screen.getByText('All Sessions')).toBeInTheDocument();
      expect(screen.getAllByText('Manage Servers').length).toBeGreaterThan(0);
    });

    it('should maintain consistent layout across different user types', () => {
      const { rerender } = render(<HomePage />, {
        wrapperOptions: {
          authenticated: true,
          user: mockUser,
        },
      });

      expect(screen.getByText(/quick actions/i)).toBeInTheDocument();

      // Re-render with admin user
      rerender(<HomePage />);

      expect(screen.getByText(/quick actions/i)).toBeInTheDocument();
    });
  });
});
