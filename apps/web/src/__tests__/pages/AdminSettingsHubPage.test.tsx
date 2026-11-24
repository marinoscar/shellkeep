import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render, mockAdminUser, mockUser } from '../utils/test-utils';
import AdminSettingsHubPage from '../../pages/AdminSettingsHubPage';
import { APP_VERSION } from '../../config/app';

describe('AdminSettingsHubPage (#46)', () => {
  it('shows an administrator every admin card', async () => {
    render(<AdminSettingsHubPage />, {
      wrapperOptions: { route: '/admin/settings', user: mockAdminUser },
    });

    expect(await screen.findByRole('heading', { name: 'Console' })).toBeInTheDocument();
    for (const title of ['About', 'Maintenance', 'Terminal', 'Users & Allowlist', 'Doctor']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it('shows a users:read-only viewer the Users card alone', async () => {
    render(<AdminSettingsHubPage />, {
      wrapperOptions: {
        route: '/admin/settings',
        user: { ...mockUser, permissions: [...mockUser.permissions, 'users:read'] },
      },
    });

    expect(await screen.findByText('Users & Allowlist')).toBeInTheDocument();
    expect(screen.queryByText('Maintenance')).not.toBeInTheDocument();
    expect(screen.queryByText('Doctor')).not.toBeInTheDocument();
  });

  describe('the version line (#147)', () => {
    it('renders "Version <APP_VERSION>" at the foot of the admin hub', async () => {
      render(<AdminSettingsHubPage />, {
        wrapperOptions: { route: '/admin/settings', user: mockAdminUser },
      });

      const line = await screen.findByTestId('app-version-line');
      expect(line).toHaveTextContent(`Version ${APP_VERSION}`);
      // A real version from package.json, not an empty or placeholder string.
      expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('renders for a users:read-only viewer too: it gates on nothing', async () => {
      render(<AdminSettingsHubPage />, {
        wrapperOptions: {
          route: '/admin/settings',
          user: { ...mockUser, permissions: [...mockUser.permissions, 'users:read'] },
        },
      });

      expect(await screen.findByText(`Version ${APP_VERSION}`)).toBeInTheDocument();
    });

    it('comes after the hub, not inside it, and does not claim to be the deployed revision', async () => {
      render(<AdminSettingsHubPage />, {
        wrapperOptions: { route: '/admin/settings', user: mockAdminUser },
      });

      const heading = await screen.findByRole('heading', { name: 'Console' });
      const line = screen.getByTestId('app-version-line');
      expect(heading.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(line.textContent).not.toMatch(/revision|commit|deployed/i);
    });
  });
});
