import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../utils/test-utils';
import UserSettingsHubPage from '../../pages/UserSettingsHubPage';

describe('UserSettingsHubPage', () => {
  it('renders the packaged hub with the Profile, Appearance and Terminal cards', async () => {
    render(<UserSettingsHubPage />, { wrapperOptions: { route: '/settings' } });

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Manage your account preferences')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
  });
});
