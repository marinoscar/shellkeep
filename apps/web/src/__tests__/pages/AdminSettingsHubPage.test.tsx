import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render, mockAdminUser, mockUser } from '../utils/test-utils';
import AdminSettingsHubPage from '../../pages/AdminSettingsHubPage';

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
});
