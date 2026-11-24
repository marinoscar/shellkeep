import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render, mockUser } from '../utils/test-utils';
import UserSettingsHubPage from '../../pages/UserSettingsHubPage';
import { APP_VERSION } from '../../config/app';

describe('UserSettingsHubPage', () => {
  it('renders the packaged hub with the Profile, Appearance and Terminal cards', async () => {
    render(<UserSettingsHubPage />, { wrapperOptions: { route: '/settings' } });

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Manage your account preferences')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
  });

  describe('the version line (#147)', () => {
    it('renders "Version <APP_VERSION>" at the foot of the user hub', async () => {
      render(<UserSettingsHubPage />, { wrapperOptions: { route: '/settings' } });

      expect(await screen.findByTestId('app-version-line')).toHaveTextContent(
        `Version ${APP_VERSION}`,
      );
    });

    it('renders for a user holding no permissions at all, who can never open About', async () => {
      // About (`/admin/settings/about`) is gated on `system_settings:read`; this
      // line asks the API nothing and gates on nothing.
      render(<UserSettingsHubPage />, {
        wrapperOptions: { route: '/settings', user: { ...mockUser, permissions: [] } },
      });

      expect(await screen.findByText(`Version ${APP_VERSION}`)).toBeInTheDocument();
    });
  });
});
