import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { mockSystemSettings } from '../../mocks/data';
import { render, mockAdminUser } from '../../utils/test-utils';
import { TerminalSystemSettingsPage } from '../../../components/terminal/settings/TerminalSystemSettingsPage';

const PROFILE = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'server-a',
  hostname: 'server-a.example.test',
  port: 22,
  username: 'person-a',
};

const readOnlyAdmin = {
  ...mockAdminUser,
  permissions: mockAdminUser.permissions.filter((p) => p !== 'system_settings:write'),
};

describe('TerminalSystemSettingsPage (#46)', () => {
  let patched: unknown[];

  beforeEach(() => {
    patched = [];
    server.use(
      http.get('*/api/server-profiles', () =>
        HttpResponse.json({ data: { items: [PROFILE], total: 1, page: 1, pageSize: 100 } }),
      ),
      http.patch('*/api/system-settings', async ({ request }) => {
        const body = await request.json();
        patched.push(body);
        return HttpResponse.json({
          data: { ...mockSystemSettings, ...(body as object), version: mockSystemSettings.version + 1 },
        });
      }),
    );
  });

  it('shows the stored thresholds and saves a change with the probe profile', async () => {
    const user = userEvent.setup();
    render(<TerminalSystemSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

    const detach = await screen.findByLabelText('Detach after (minutes)');
    expect(detach).toHaveValue(60);
    expect(screen.getByLabelText('Terminate detached sessions after (hours)')).toHaveValue(12);
    expect(screen.getByLabelText('Purge terminated sessions after (days)')).toHaveValue(3);

    await user.clear(detach);
    await user.type(detach, '90');
    await user.click(screen.getByLabelText('Probe server profile'));
    await user.click(await screen.findByRole('option', { name: /server-a/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toEqual({
      terminal: {
        detachAfterMinutes: 90,
        terminateDetachedAfterHours: 12,
        purgeTerminatedAfterDays: 3,
        doctorProbeProfileId: PROFILE.id,
      },
    });
    expect(await screen.findByText('Terminal settings saved')).toBeInTheDocument();
  });

  it('refuses an out-of-range threshold before sending it', async () => {
    const user = userEvent.setup();
    render(<TerminalSystemSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

    const purge = await screen.findByLabelText('Purge terminated sessions after (days)');
    await user.clear(purge);
    await user.type(purge, '400');

    expect(screen.getByText('Enter a whole number from 1 to 365.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(patched).toHaveLength(0);
  });

  it('is read-only without system_settings:write', async () => {
    render(<TerminalSystemSettingsPage />, { wrapperOptions: { user: readOnlyAdmin } });

    expect(await screen.findByLabelText('Detach after (minutes)')).toBeDisabled();
    expect(screen.getByText(/\(read-only\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    const probeCard = screen.getByText('Doctor probe').closest('div') as HTMLElement;
    expect(within(probeCard).getByText(/skip/i)).toBeInTheDocument();
  });
});
