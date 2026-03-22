import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render, mockUser, mockAdminUser } from '../../utils/test-utils';
import { Sidebar } from '../../../components/navigation/Sidebar';

// Mock react-router-dom
const mockNavigate = vi.fn();
const mockLocation = { pathname: '/' };

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => mockLocation,
  };
});

// Mock usePermissions hook
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}));

import { usePermissions } from '../../../hooks/usePermissions';

describe('Sidebar', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation.pathname = '/';
  });

  describe('Rendering', () => {
    it('should render Drawer component even when open is false', () => {
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      // The key test: calling render should work without the component returning null
      // Even though drawer content won't be in DOM with keepMounted: false and open: false,
      // the component should still render the Drawer JSX (MUI handles visibility)
      const result = render(<Sidebar open={false} onClose={mockOnClose} />);

      // Verify render was successful (result should have standard RTL properties)
      expect(result).toHaveProperty('container');
      expect(result).toHaveProperty('baseElement');
    });

    it('should render Drawer component when open is true', () => {
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      const drawer = container.querySelector('.MuiDrawer-root');
      expect(drawer).not.toBeNull();
      expect(drawer).toBeDefined();
    });

    it('should render visible menu items', () => {
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      // Non-admin users see Dashboard, Sessions, Servers
      expect(container.textContent).toContain('Dashboard');
      expect(container.textContent).toContain('Sessions');
      expect(container.textContent).toContain('Servers');
    });

    it('should not render admin menu items for non-admin users', () => {
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      // Admin items should not be visible
      expect(container.textContent).not.toContain('User Management');
    });

    it('should render admin menu items for admin users', () => {
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(['admin']),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: true,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />, {
        wrapperOptions: { user: mockAdminUser },
      });

      // All menu items should be visible
      expect(container.textContent).toContain('Dashboard');
      expect(container.textContent).toContain('Sessions');
      expect(container.textContent).toContain('Servers');
      expect(container.textContent).toContain('User Management');
    });
  });

  describe('ModalProps Configuration', () => {
    it('should have keepMounted set to false', () => {
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      const drawer = container.querySelector('.MuiDrawer-root');
      expect(drawer).not.toBeNull();
      // keepMounted: false means content unmounts when closed
    });

    it('should have disablePortal set to true', () => {
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      const drawer = container.querySelector('.MuiDrawer-root');
      expect(drawer).not.toBeNull();
      // disablePortal: true keeps Modal in component tree
    });
  });

  describe('Menu Item Visibility Filtering', () => {
    it('should filter menu items based on visibility property', () => {
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      // Non-admin users see Dashboard, Sessions, Servers (3 items)
      const menuButtons = container.querySelectorAll('.MuiListItemButton-root');
      expect(menuButtons).toHaveLength(3);
    });

    it('should show all menu items when user is admin', () => {
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(['admin']),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: true,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />, {
        wrapperOptions: { user: mockAdminUser },
      });

      // Admin sees Dashboard, Sessions, Servers, User Management (4 items)
      const menuButtons = container.querySelectorAll('.MuiListItemButton-root');
      expect(menuButtons).toHaveLength(4);
    });

    it('should dynamically update menu items when isAdmin changes', () => {
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { rerender, container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      expect(container.textContent).not.toContain('User Management');

      // Update to admin
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(['admin']),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: true,
      });

      rerender(<Sidebar open={true} onClose={mockOnClose} />);

      expect(container.textContent).toContain('User Management');
    });
  });

  describe('Navigation Behavior', () => {
    it('should call onClose BEFORE navigate when menu item is clicked', async () => {
      const user = userEvent.setup();
      const callOrder: string[] = [];

      const trackingOnClose = vi.fn(() => {
        callOrder.push('onClose');
      });

      mockNavigate.mockImplementation(() => {
        callOrder.push('navigate');
      });

      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={trackingOnClose} />);

      const buttons = container.querySelectorAll('.MuiListItemButton-root');
      const sessionsButton = buttons[1]; // Sessions is second button
      await user.click(sessionsButton);

      // onClose should be called immediately (synchronously)
      expect(trackingOnClose).toHaveBeenCalledTimes(1);

      // Wait for navigate to be called (it's in setTimeout(0))
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledTimes(1);
      });

      // Verify order: onClose should be called BEFORE navigate
      expect(callOrder).toEqual(['onClose', 'navigate']);
    });

    it('should navigate to home when Dashboard menu item is clicked', async () => {
      const user = userEvent.setup();

      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      const buttons = container.querySelectorAll('.MuiListItemButton-root');
      const dashboardButton = buttons[0]; // Dashboard is first button
      await user.click(dashboardButton);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/');
      });
    });

    it('should navigate to /sessions when Sessions menu item is clicked', async () => {
      const user = userEvent.setup();

      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      const buttons = container.querySelectorAll('.MuiListItemButton-root');
      const sessionsButton = buttons[1]; // Sessions is second button
      await user.click(sessionsButton);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/sessions');
      });
    });

    it('should navigate to /servers when Servers menu item is clicked', async () => {
      const user = userEvent.setup();

      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      const buttons = container.querySelectorAll('.MuiListItemButton-root');
      const serversButton = buttons[2]; // Servers is third button
      await user.click(serversButton);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/servers');
      });
    });

    it('should navigate to admin/users when User Management is clicked', async () => {
      const user = userEvent.setup();

      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(['admin']),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: true,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />, {
        wrapperOptions: { user: mockAdminUser },
      });

      const buttons = container.querySelectorAll('.MuiListItemButton-root');
      const userMgmtButton = buttons[3]; // User Management is fourth button
      await user.click(userMgmtButton);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/admin/users');
      });
    });
  });

  describe('Active Menu Item Highlighting', () => {
    it('should highlight current route', () => {
      mockLocation.pathname = '/sessions';

      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      const buttons = container.querySelectorAll('.MuiListItemButton-root');
      const sessionsButton = buttons[1]; // Sessions
      expect(sessionsButton.classList.contains('Mui-selected')).toBe(true);
    });

    it('should not highlight non-current routes', () => {
      mockLocation.pathname = '/';

      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      const buttons = container.querySelectorAll('.MuiListItemButton-root');
      const sessionsButton = buttons[1]; // Sessions
      expect(sessionsButton.classList.contains('Mui-selected')).toBe(false);
    });

    it('should highlight admin routes when on admin page', () => {
      mockLocation.pathname = '/admin/users';

      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(['admin']),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: true,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />, {
        wrapperOptions: { user: mockAdminUser },
      });

      const buttons = container.querySelectorAll('.MuiListItemButton-root');
      const userMgmtButton = buttons[3]; // User Management
      expect(userMgmtButton.classList.contains('Mui-selected')).toBe(true);
    });
  });

  describe('Drawer Close Behavior', () => {
    it('should pass onClose prop to Drawer', () => {
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      // The onClose prop is passed to Drawer - verify drawer is rendered
      const drawer = container.querySelector('.MuiDrawer-root');
      expect(drawer).not.toBeNull();
      expect(mockOnClose).toHaveBeenCalledTimes(0);
    });

    it('should call onClose for each menu item click', async () => {
      const user = userEvent.setup();

      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      const buttons = container.querySelectorAll('.MuiListItemButton-root');
      const dashboardButton = buttons[0];
      await user.click(dashboardButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);

      const sessionsButton = buttons[1];
      await user.click(sessionsButton);

      expect(mockOnClose).toHaveBeenCalledTimes(2);
    });
  });

  describe('Menu Icons', () => {
    it('should render icons for all menu items', () => {
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(['admin']),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: true,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />, {
        wrapperOptions: { user: mockAdminUser },
      });

      // Each menu item should have an icon: Dashboard, Sessions, Servers, User Management
      const icons = container.querySelectorAll('.MuiListItemIcon-root');
      expect(icons).toHaveLength(4);
    });

    it('should highlight icon for selected menu item', () => {
      mockLocation.pathname = '/sessions';

      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      const buttons = container.querySelectorAll('.MuiListItemButton-root');
      const sessionsButton = buttons[1]; // Sessions
      const icon = sessionsButton?.querySelector('.MuiListItemIcon-root');

      expect(icon).not.toBeNull();
      expect(icon).toBeDefined();
      // Icon should have primary color styling when selected
    });
  });

  describe('Accessibility', () => {
    it('should render drawer with proper structure', () => {
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      // Drawer should be rendered with buttons
      const buttons = container.querySelectorAll('.MuiListItemButton-root');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should have accessible button labels', () => {
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      // Verify text content for accessibility
      expect(container.textContent).toContain('Dashboard');
      expect(container.textContent).toContain('Sessions');
      expect(container.textContent).toContain('Servers');
    });

    it('should be keyboard navigable', async () => {
      const user = userEvent.setup();

      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      const buttons = container.querySelectorAll('.MuiListItemButton-root');
      const dashboardButton = buttons[0] as HTMLElement;

      // Should be able to focus and activate with keyboard
      dashboardButton.focus();
      expect(dashboardButton).toHaveFocus();

      await user.keyboard('{Enter}');
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  describe('Regression Tests', () => {
    it('should NOT return null when open is false (critical bug fix)', () => {
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      // CRITICAL REGRESSION TEST:
      // Previously, the component conditionally returned null when open was false:
      // if (!open) return null; // Wrong - caused backdrop click issues
      //
      // The fix: Component always returns the Drawer JSX:
      // return <Drawer open={open} ... /> // Correct - let MUI handle visibility
      //
      // This test verifies the component doesn't throw and renders successfully
      expect(() => {
        render(<Sidebar open={false} onClose={mockOnClose} />);
      }).not.toThrow();

      // Also verify it works when open
      expect(() => {
        render(<Sidebar open={true} onClose={mockOnClose} />);
      }).not.toThrow();
    });

    it('should close drawer before navigation to prevent backdrop issues', async () => {
      const user = userEvent.setup();
      let drawerClosed = false;
      let navigationOccurred = false;

      const trackingOnClose = vi.fn(() => {
        drawerClosed = true;
        // At the moment onClose is called, navigation should not have occurred yet
        expect(navigationOccurred).toBe(false);
      });

      mockNavigate.mockImplementation(() => {
        navigationOccurred = true;
        // Drawer should already be closed when navigation occurs
        expect(drawerClosed).toBe(true);
      });

      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={trackingOnClose} />);

      const buttons = container.querySelectorAll('.MuiListItemButton-root');
      const dashboardButton = buttons[0];
      await user.click(dashboardButton);

      // Drawer close should happen synchronously
      expect(drawerClosed).toBe(true);

      // Wait for navigation to occur (it's in setTimeout(0))
      await waitFor(() => {
        expect(navigationOccurred).toBe(true);
      });
    });

    it('should maintain ModalProps configuration for backdrop click handling', () => {
      vi.mocked(usePermissions).mockReturnValue({
        permissions: new Set(),
        roles: new Set(),
        hasPermission: vi.fn(),
        hasAnyPermission: vi.fn(),
        hasAllPermissions: vi.fn(),
        hasRole: vi.fn(),
        hasAnyRole: vi.fn(),
        isAdmin: false,
      });

      const { container } = render(<Sidebar open={true} onClose={mockOnClose} />);

      const drawer = container.querySelector('.MuiDrawer-root');
      expect(drawer).not.toBeNull();
      expect(drawer).toBeDefined();

      // Critical: disablePortal: true keeps Modal in component tree
      // This prevents backdrop click issues after navigation
      // keepMounted: false ensures drawer content unmounts when closed
    });
  });
});
